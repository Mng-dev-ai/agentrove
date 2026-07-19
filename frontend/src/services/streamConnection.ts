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
  // Chats replayed at open; missing chat forces reopen with fresh cursors.
  replayedChatIds: Set<string>;
  retryAttempts: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  stableTimer: ReturnType<typeof setTimeout> | null;
  // Bumped on (re)open/teardown so in-flight async opens self-cancel.
  generation: number;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;
// Stay open this long before resetting retry budget (avoids open→die loops).
const CONNECTION_STABLE_MS = 15000;

// One multiplexed SSE per API host (browsers cap ~6 HTTP/1.1 sockets per origin).
// Opens when streamStore has active streams; closes when the last is removed.
class StreamConnectionManager {
  private connections = new Map<StreamApiClient, ManagedConnection>();
  private handlers: StreamConnectionHandlers | null = null;

  configure(handlers: StreamConnectionHandlers): void {
    this.handlers = handlers;
    useStreamStore.subscribe(() => this.reconcile());
  }

  // Reopen if needed so this chat is in the replay cursor set.
  requestReplay(chatId: string): void {
    const client = resolveChatClient(chatId);
    const connection = this.connections.get(client);
    if (!connection) {
      // reconcile() will open with this chat's cursor; nothing to force.
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
      // Drop ended streams from replay set so a later turn can force replay again.
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
    // chatStorage is the freshest resume point; 0 means replay from start.
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
    // Sync snapshot so a requestReplay racing token fetch sees this open's set.
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
    // Mint fresh token every open — long-lived feed may outlive the cached one.
    const token = await client.getValidToken();
    if (this.connections.get(client) !== connection || connection.generation !== generation) {
      return;
    }
    if (!token) {
      // Use open-time chat set — cloud expiry clears origin registry mid-flight.
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
      // Manual reopen with fresh cursors — EventSource auto-reconnect uses stale URL.
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
    // Keep map entry while failing streams so reconcile doesn't reopen mid-loop.
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

  // Bump generation to strand any in-flight connect().
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
