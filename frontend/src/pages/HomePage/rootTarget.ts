import type { Channel } from '@/types/channel.types';
import type { Chat } from '@/types/chat.types';
import type { LastThread } from '@/types/ui.types';

export type RootTarget = { kind: 'loading' } | { kind: 'thread'; path: string } | { kind: 'empty' };

interface RootTargetInput {
  lastThread: LastThread | null;
  // Whether the recorded thread still answers; 'gone' also covers no record
  lastThreadStatus: 'exists' | 'pending' | 'gone';
  chats: Pick<Chat, 'id' | 'updated_at'>[];
  channels: Pick<Channel, 'id' | 'updated_at'>[];
  isLoadingThreads: boolean;
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
