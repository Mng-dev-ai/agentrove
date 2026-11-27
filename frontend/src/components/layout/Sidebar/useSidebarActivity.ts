import { useMemo } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { chatQuery } from '@/hooks/queries/useChatQueries';
import { channelActivity, useChannelStore } from '@/store/channelStore';
import type { Chat } from '@/types/chat.types';
import type { SidebarActivityKind } from '@/store/sidebarFilters';
import {
  channelActivityKind,
  threadUpdatedAt,
  type MachineChannel,
  type SidebarThread,
} from './sidebarGrouping';

export interface ChildActivity {
  running: number;
  needsYou: number;
}

function loadedChats(results: UseQueryResult<Chat>[]): Chat[] {
  return results.flatMap((result) => (result.data ? [result.data] : []));
}

function addChildActivity(
  byParentId: Map<string, ChildActivity>,
  parentId: string,
  kind: SidebarActivityKind,
): void {
  const activity = byParentId.get(parentId) ?? { running: 0, needsYou: 0 };
  if (kind === 'needs-you') activity.needsYou += 1;
  else activity.running += 1;
  byParentId.set(parentId, activity);
}

// Every running or blocked thread and channel, sub-threads and linked channels of
// collapsed parents included. Chat records come from the per-chat query, since collapsed
// sub-threads aren't loaded. Channel member chats are left out: each channel is counted
// once from its own member activity instead.
export function useSidebarActivity(
  streamingChatIdSet: Set<string>,
  blockedChatIdSet: Set<string>,
  machineChannels: MachineChannel[],
  linkedChannelsByParentId: Map<string, MachineChannel[]>,
) {
  const activeChatIds = useMemo(
    () => [...new Set([...blockedChatIdSet, ...streamingChatIdSet])],
    [blockedChatIdSet, streamingChatIdSet],
  );
  const chats = useQueries({
    queries: activeChatIds.map((chatId) => chatQuery(chatId)),
    combine: loadedChats,
  });
  const liveActivity = useChannelStore((state) => state.activity);

  return useMemo(() => {
    const channelKinds = new Map(
      machineChannels.map(({ channel }) => [
        channel.id,
        channelActivityKind(channelActivity(liveActivity[channel.id], channel.activity)),
      ]),
    );
    const entriesByKind: Record<SidebarActivityKind, SidebarThread[]> = {
      'needs-you': [],
      running: [],
    };
    const childActivityByParentId = new Map<string, ChildActivity>();
    for (const chat of chats) {
      if (chat.channel_id) continue;
      const kind = blockedChatIdSet.has(chat.id) ? 'needs-you' : 'running';
      entriesByKind[kind].push({ kind: 'chat', chat });
      if (chat.parent_chat_id) addChildActivity(childActivityByParentId, chat.parent_chat_id, kind);
    }
    for (const { channel, machineId } of machineChannels) {
      const kind = channelKinds.get(channel.id);
      if (kind) entriesByKind[kind].push({ kind: 'channel', channel, machineId });
    }
    for (const [parentId, linked] of linkedChannelsByParentId) {
      for (const { channel } of linked) {
        const kind = channelKinds.get(channel.id);
        if (kind) addChildActivity(childActivityByParentId, parentId, kind);
      }
    }
    for (const entries of Object.values(entriesByKind)) {
      entries.sort((a, b) => threadUpdatedAt(b).localeCompare(threadUpdatedAt(a)));
    }
    return { entriesByKind, childActivityByParentId };
  }, [chats, blockedChatIdSet, machineChannels, linkedChannelsByParentId, liveActivity]);
}
