import type { Chat } from '@/types/chat.types';

export interface RecentChatSource {
  chats: Chat[];
  hasMore: boolean;
}

export function mergeRecentChatSources(sources: RecentChatSource[]): Chat[] {
  let floor = -Infinity;
  for (const source of sources) {
    if (source.hasMore && source.chats.length > 0) {
      floor = Math.max(floor, Date.parse(source.chats[source.chats.length - 1].updated_at));
    }
  }
  return sources
    .flatMap((source) => source.chats)
    .filter((chat) => Date.parse(chat.updated_at) >= floor)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}
