import type { PermissionOption } from '@/types/chat.types';

export function filterOptions(
  options: PermissionOption[],
  prefix: 'allow' | 'reject',
): PermissionOption[] {
  return options.filter((o) => o.kind.startsWith(prefix));
}

// Tracks resolved permission requests by their stream sequence so that
// permission events the backend replays after `after_seq` (page refresh,
// reconnect from a stale cursor) are not re-shown once the user has already
// answered them. Keyed by `${chatId}:${seq}` rather than request_id: seq is
// monotonic per chat and unique per emission, so a new request in a later turn
// is never blocked even when a provider reuses tool-call ids. Persisted across
// reloads (that is the whole point — the in-memory queue is empty on refresh)
// and capped to bound storage.
const RESOLVED_PERMISSIONS_KEY = 'agentrove_resolved_permission_seqs';
const MAX_RESOLVED_PERMISSIONS = 200;

function resolvedKey(chatId: string, seq: number): string {
  return `${chatId}:${seq}`;
}

function getResolvedPermissions(): string[] {
  try {
    const stored = localStorage.getItem(RESOLVED_PERMISSIONS_KEY);
    return stored ? (JSON.parse(stored) as string[]) : [];
  } catch {
    return [];
  }
}

export function addResolvedPermission(chatId: string, seq: number): void {
  try {
    const key = resolvedKey(chatId, seq);
    const resolved = getResolvedPermissions();
    if (resolved.includes(key)) return;
    resolved.push(key);
    if (resolved.length > MAX_RESOLVED_PERMISSIONS) {
      resolved.splice(0, resolved.length - MAX_RESOLVED_PERMISSIONS);
    }
    localStorage.setItem(RESOLVED_PERMISSIONS_KEY, JSON.stringify(resolved));
  } catch {
    // Ignore localStorage errors
  }
}

export function isPermissionResolved(chatId: string, seq: number): boolean {
  return getResolvedPermissions().includes(resolvedKey(chatId, seq));
}
