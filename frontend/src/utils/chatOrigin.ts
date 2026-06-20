// Tracks which chat IDs and sandbox IDs live on the cloud VPS rather than the
// local instance, so chatService and sandboxService can route per-chat and
// per-sandbox API calls (reads, status, SSE, files, git, terminal) to the
// backend that owns them. Single-user app: IDs are unique across the two
// backends, so flat sets are enough — no need to namespace by origin.
//
// Persisted to localStorage and hydrated synchronously at module load: a reload
// or a direct deep-link to /chat/:id must resolve origin before the chat and
// sandbox queries fire, otherwise they would fall back to the local backend.
const CHATS_KEY = 'cloud-chat-ids';
const SANDBOXES_KEY = 'cloud-sandbox-ids';

function load(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

const cloudChatIds = load(CHATS_KEY);
const cloudSandboxIds = load(SANDBOXES_KEY);

function persist(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable/full — routing still works for this session in-memory.
  }
}

function add(ids: string[], set: Set<string>, key: string): void {
  let changed = false;
  for (const id of ids) {
    if (!set.has(id)) {
      set.add(id);
      changed = true;
    }
  }
  if (changed) persist(key, set);
}

export function markCloudChats(ids: string[]): void {
  add(ids, cloudChatIds, CHATS_KEY);
}

export function isCloudChat(id: string): boolean {
  return cloudChatIds.has(id);
}

export function markCloudSandboxes(ids: string[]): void {
  add(ids, cloudSandboxIds, SANDBOXES_KEY);
}

export function isCloudSandbox(id: string): boolean {
  return cloudSandboxIds.has(id);
}

// Reset all cloud-origin tracking — called on VPS disconnect.
export function clearCloudOrigins(): void {
  cloudChatIds.clear();
  cloudSandboxIds.clear();
  persist(CHATS_KEY, cloudChatIds);
  persist(SANDBOXES_KEY, cloudSandboxIds);
}
