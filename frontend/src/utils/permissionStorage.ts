import type { PermissionOption } from '@/types/chat.types';

export function filterOptions(
  options: PermissionOption[],
  prefix: 'allow' | 'reject',
): PermissionOption[] {
  return options.filter((o) => o.kind.startsWith(prefix));
}

// Resolved permission seqs so SSE replays after refresh don't re-show them.
// Keyed by chatId:seq (not request_id) — providers may reuse tool-call ids.
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
    // localStorage unavailable/full
  }
}

export function isPermissionResolved(chatId: string, seq: number): boolean {
  return getResolvedPermissions().includes(resolvedKey(chatId, seq));
}
