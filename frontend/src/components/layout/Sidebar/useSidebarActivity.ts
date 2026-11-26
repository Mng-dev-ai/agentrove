import { useMemo } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { chatQuery } from '@/hooks/queries/useChatQueries';
import type { Chat } from '@/types/chat.types';
import type { SidebarActivityKind } from '@/store/sidebarFilters';

export interface ChildActivity {
  running: number;
  needsYou: number;
}

function loadedChats(results: UseQueryResult<Chat>[]): Chat[] {
  return results.flatMap((result) => (result.data ? [result.data] : []));
}

// Every running or blocked thread, sub-threads of collapsed parents included. Chat
// records come from the per-chat query, since collapsed sub-threads aren't loaded.
// Channel member chats are left out: their channel row already shows the activity.
export function useSidebarActivity(streamingChatIdSet: Set<string>, blockedChatIdSet: Set<string>) {
  const activeChatIds = useMemo(
    () => [...new Set([...blockedChatIdSet, ...streamingChatIdSet])],
    [blockedChatIdSet, streamingChatIdSet],
  );
  const chats = useQueries({
    queries: activeChatIds.map((chatId) => chatQuery(chatId)),
    combine: loadedChats,
  });

  return useMemo(() => {
    const listed = chats
      .filter((chat) => !chat.channel_id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const chatsByKind: Record<SidebarActivityKind, Chat[]> = {
      'needs-you': listed.filter((chat) => blockedChatIdSet.has(chat.id)),
      running: listed.filter((chat) => !blockedChatIdSet.has(chat.id)),
    };
    const childActivityByParentId = new Map<string, ChildActivity>();
    for (const chat of listed) {
      if (!chat.parent_chat_id) continue;
      const activity = childActivityByParentId.get(chat.parent_chat_id) ?? {
        running: 0,
        needsYou: 0,
      };
      if (blockedChatIdSet.has(chat.id)) activity.needsYou += 1;
      else activity.running += 1;
      childActivityByParentId.set(chat.parent_chat_id, activity);
    }
    return { chatsByKind, childActivityByParentId };
  }, [chats, blockedChatIdSet]);
}
