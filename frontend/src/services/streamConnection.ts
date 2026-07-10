import { resolveChatClient } from '@/lib/api';
import { useStreamStore } from '@/store/streamStore';
import { chatStorage } from '@/utils/storage';
import { logger } from '@/utils/logger';

type StreamApiClient = ReturnType<typeof resolveChatClient>;

interface StreamConnectionHandlers {
  onEnvelopeData: (raw: string) => void;
  onConnectionFailure: (chatIds: string[]) => void;
}

interface ManagedConnection {
  source: EventSource | null;
  // Chats whose backlog the current EventSource replayed at open — a chat
  // needing replay that isn't in here forces a reopen with fresh cursors.
  replayedChatIds: Set<string>;
  retryAttempts: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  stableTimer: ReturnType<typeof setTimeout> | null;
  // Bumped on every (re)open/teardown so in-flight async opens self-cancel.
  generation: number;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
// How long a connection must stay open before its retry budget resets — an
// instant reset on `open` would let a feed that 200s then immediately dies
// (e.g. Redis down) loop forever without ever tripping the failure path.
const CONNECTION_STABLE_MS = 15000;

// Owns the single multiplexed SSE connection per API host (local + cloud). The
// server forwards every stream envelope for the user over one connection, so N
// streaming chats no longer hold N sockets — browsers cap HTTP/1.1 at 6 per
// origin, which froze all other requests once ~6 chats streamed concurrently.
// Lifecycle is store-driven: the connection opens when a client's first active
// stream registers in streamStore and closes when its last one is removed.
class StreamConnectionManager {
  private connections = new Map<StreamApiClient, ManagedConnection>();
  private handlers: StreamConnectionHandlers | null = null;

  configure(handlers: StreamConnectionHandlers): void {
    this.handlers = handlers;
    useStreamStore.subscribe(() => this.reconcile());
  }

  // Force the next connection for this chat's host to include it in the replay
  // cursor set — reopens a live connection, since an already-open feed only
  // carries events published after it connected.
  requestReplay(chatId: string): void {
    const client = resolveChatClient(chatId);
    const connection = this.connections.get(client);
    if (!connection) {
      // reconcile() (triggered by the stream registration) opens it with this
      // chat's cursor included; nothing to force.
      return;
    }
    if (!connection.replayedChatIds.has(chatId)) {
      this.open(client);
    }
  }

  private reconcile(): void {
    const byClient = this.activeChatIdsByClient();

    for (const [client, connection] of this.connections) {
      const activeChatIds = byClient.get(client);
      if (!activeChatIds) {
        this.teardown(client, connection);
        continue;
      }
      // Replay membership is per registered stream, not per connection lifetime:
      // once a chat's stream ends, a later turn in it must be able to force a
      // replay again — its send-window events arrive before the new stream
      // registers and would otherwise never be recovered.
      for (const chatId of connection.replayedChatIds) {
        if (!activeChatIds.has(chatId)) {
          connection.replayedChatIds.delete(chatId);
        }
      }
    }

    for (const client of byClient.keys()) {
      if (!this.connections.has(client)) {
        this.open(client);
      }
    }
  }

  private activeChatIdsByClient(): Map<StreamApiClient, Set<string>> {
    const byClient = new Map<StreamApiClient, Set<string>>();
    for (const stream of useStreamStore.getState().activeStreams.values()) {
      if (!stream.isActive) continue;
      const client = resolveChatClient(stream.chatId);
      const chatIds = byClient.get(client) ?? new Set<string>();
      chatIds.add(stream.chatId);
      byClient.set(client, chatIds);
    }
    return byClient;
  }

  private buildCursors(chatIds: Set<string>): Record<string, number> {
    // chatStorage cursors advance on every processed envelope, so they are the
    // freshest resume point; 0 (no cursor) means replay the chat from the start.
    const cursors: Record<string, number> = {};
    for (const chatId of chatIds) {
      const stored = Number(chatStorage.getEventId(chatId) || 0);
      cursors[chatId] = Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0;
    }
    return cursors;
  }

  private open(client: StreamApiClient): void {
    const connection = this.connections.get(client) ?? {
      source: null,
      replayedChatIds: new Set<string>(),
      retryAttempts: 0,
      retryTimer: null,
      stableTimer: null,
      generation: 0,
    };
    this.connections.set(client, connection);

    const chatIds = this.activeChatIdsByClient().get(client);
    if (!chatIds || chatIds.size === 0) {
      this.teardown(client, connection);
      return;
    }

    const generation = this.resetSocket(connection);
    // Snapshot cursors synchronously so a requestReplay racing the token fetch
    // sees exactly which chats this open will replay.
    const cursors = this.buildCursors(chatIds);
    connection.replayedChatIds = new Set(chatIds);

    void this.connect(client, connection, generation, cursors, chatIds).catch((error) => {
      logger.error('Stream connection open failed', 'streamConnection', error);
      if (this.connections.get(client) === connection && connection.generation === generation) {
        this.scheduleReconnect(client, connection);
      }
    });
  }

  private async connect(
    client: StreamApiClient,
    connection: ManagedConnection,
    generation: number,
    cursors: Record<string, number>,
    chatIds: Set<string>,
  ): Promise<void> {
    // The connection is long-lived and reopens after failures, so the cached
    // token may be expired — mint a fresh one on every open.
    const token = await client.getValidToken();
    if (this.connections.get(client) !== connection || connection.generation !== generation) {
      return;
    }
    if (!token) {
      // Session is dead (getValidToken already tore it down) — fail the streams
      // instead of retrying an unauthenticatable feed forever. Use the open-time
      // chat set: cloud session expiry clears the cloud-origin registry, so a
      // recompute here would resolve those chats to the local client and miss them.
      this.failClient(client, connection, chatIds);
      return;
    }

    const params = new URLSearchParams();
    params.append('token', token);
    params.append('cursors', JSON.stringify(cursors));
    const source = new EventSource(`${client.getBaseUrl()}/chat/chats/streams?${params}`);
    connection.source = source;

    source.addEventListener('stream', (event: Event) => {
      const data = (event as MessageEvent).data;
      if (data) this.handlers?.onEnvelopeData(data);
    });
    source.onopen = () => {
      if (connection.source !== source || connection.stableTimer) return;
      connection.stableTimer = setTimeout(() => {
        connection.stableTimer = null;
        connection.retryAttempts = 0;
      }, CONNECTION_STABLE_MS);
    };
    source.onerror = () => {
      if (connection.source !== source) return;
      if (connection.stableTimer) {
        clearTimeout(connection.stableTimer);
        connection.stableTimer = null;
      }
      // Don't let EventSource auto-reconnect: its URL carries the cursors from
      // open time, so chats subscribed since then would lose the outage window.
      // Reopening ourselves rebuilds cursors from fresh chatStorage state.
      source.close();
      connection.source = null;
      this.scheduleReconnect(client, connection);
    };
  }

  private scheduleReconnect(client: StreamApiClient, connection: ManagedConnection): void {
    if (connection.retryTimer) return;
    connection.retryAttempts += 1;
    if (connection.retryAttempts > MAX_RECONNECT_ATTEMPTS) {
      this.failClient(client, connection);
      return;
    }
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** (connection.retryAttempts - 1),
      RECONNECT_MAX_DELAY_MS,
    );
    connection.retryTimer = setTimeout(() => {
      connection.retryTimer = null;
      this.open(client);
    }, delay);
  }

  private failClient(
    client: StreamApiClient,
    connection: ManagedConnection,
    affectedChatIds?: Set<string>,
  ): void {
    const chatIds = affectedChatIds ?? this.activeChatIdsByClient().get(client);
    // Kill the socket but keep the map entry while the failure callback removes
    // streams — each removal triggers reconcile, and a missing entry would
    // immediately reopen a doomed connection mid-loop.
    this.resetSocket(connection);
    if (chatIds && chatIds.size > 0) {
      this.handlers?.onConnectionFailure([...chatIds]);
    }
    this.teardown(client, connection);
  }

  private teardown(client: StreamApiClient, connection: ManagedConnection): void {
    this.resetSocket(connection);
    this.connections.delete(client);
  }

  // Bumping the generation strands any in-flight connect() for this connection.
  private resetSocket(connection: ManagedConnection): number {
    connection.generation += 1;
    if (connection.retryTimer) {
      clearTimeout(connection.retryTimer);
      connection.retryTimer = null;
    }
    if (connection.stableTimer) {
      clearTimeout(connection.stableTimer);
      connection.stableTimer = null;
    }
    connection.source?.close();
    connection.source = null;
    return connection.generation;
  }
}

export const streamConnection = new StreamConnectionManager();
