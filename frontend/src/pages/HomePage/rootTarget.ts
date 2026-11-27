import type { Channel } from '@/types/channel.types';
import type { Chat } from '@/types/chat.types';
import type { LastThread } from '@/types/ui.types';

export type RootTarget = { kind: 'loading' } | { kind: 'thread'; path: string } | { kind: 'empty' };

type ThreadStatus = 'exists' | 'pending' | 'gone';

interface RootTargetInput {
  lastThread: LastThread | null;
  // Whether the recorded thread still answers; 'gone' also covers no record
  lastThreadStatus: ThreadStatus;
  chats: Pick<Chat, 'id' | 'updated_at'>[];
  channels: Pick<Channel, 'id' | 'updated_at'>[];
  isLoadingThreads: boolean;
}

export const isNotFoundError = (error: unknown): boolean =>
  (error as { status?: number } | null)?.status === 404;

// Only a 404 means gone, and it outranks cached data. Any other error (a machine not yet
// online, a 5xx) still opens the thread, whose page shows that state and recovers.
export function recordedThreadStatus(query: { data: unknown; error: unknown }): ThreadStatus {
  if (isNotFoundError(query.error)) return 'gone';
  return query.data || query.error ? 'exists' : 'pending';
}

export function threadPath({ kind, id }: LastThread): string {
  return kind === 'chat' ? `/chat/${id}` : `/channels/${id}`;
}

// The sidebar lists can still hold a thread that just went away, so the fallback skips the
// recorded one: a gone thread sends the user back here, never to itself.
export function resolveRootTarget({
  lastThread,
  lastThreadStatus,
  chats,
  channels,
  isLoadingThreads,
}: RootTargetInput): RootTarget {
  if (lastThread && lastThreadStatus === 'exists') {
    return { kind: 'thread', path: threadPath(lastThread) };
  }
  if (lastThreadStatus === 'pending' || isLoadingThreads) return { kind: 'loading' };
  const candidates: (LastThread & { updatedAt: number })[] = [
    ...chats.map(({ id, updated_at }) => ({
      kind: 'chat' as const,
      id,
      updatedAt: Date.parse(updated_at),
    })),
    ...channels.map(({ id, updated_at }) => ({
      kind: 'channel' as const,
      id,
      updatedAt: Date.parse(updated_at),
    })),
  ].filter(({ id }) => id !== lastThread?.id);
  if (candidates.length === 0) return { kind: 'empty' };
  const newest = candidates.reduce((best, next) => (next.updatedAt > best.updatedAt ? next : best));
  return { kind: 'thread', path: threadPath(newest) };
}
