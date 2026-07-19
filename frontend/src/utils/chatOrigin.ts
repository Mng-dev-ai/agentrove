// Cloud-owned chat/sandbox IDs for routing API calls to the VPS.
// Flat sets are enough (single-user; IDs unique across backends).
// Hydrated sync at load so deep-links don't fall back to the local backend.
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

export function clearCloudOrigins(): void {
  cloudChatIds.clear();
  cloudSandboxIds.clear();
  persist(CHATS_KEY, cloudChatIds);
  persist(SANDBOXES_KEY, cloudSandboxIds);
}
