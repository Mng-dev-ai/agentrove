import { useMemo } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { chatQuery } from '@/hooks/queries/useChatQueries';
import { channelActivity, useChannelStore } from '@/store/channelStore';
import type { Channel, ChannelMemberActivity } from '@/types/channel.types';
import type { Chat } from '@/types/chat.types';
import type { SidebarActivityKind } from '@/store/sidebarFilters';
import type { MachineChannel } from './sidebarGrouping';

export interface ChildActivity {
  running: number;
  needsYou: number;
}

export type SidebarActivityEntry =
  | { kind: 'chat'; chat: Chat }
  | { kind: 'channel'; channel: Channel; machineId: string };

function loadedChats(results: UseQueryResult<Chat>[]): Chat[] {
  return results.flatMap((result) => (result.data ? [result.data] : []));
}

function entryUpdatedAt(entry: SidebarActivityEntry): string {
  return entry.kind === 'chat' ? entry.chat.updated_at : entry.channel.updated_at;
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

// A channel counts once: needs-you while any member waits on the user, else running
// while any member has a turn going.
export function channelActivityKind(activity: ChannelMemberActivity): SidebarActivityKind | null {
  if (activity.waiting_member_ids.length > 0) return 'needs-you';
  if (activity.member_ids.length > 0) return 'running';
  return null;
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
    const entriesByKind: Record<SidebarActivityKind, SidebarActivityEntry[]> = {
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
      entries.sort((a, b) => entryUpdatedAt(b).localeCompare(entryUpdatedAt(a)));
    }
    return { entriesByKind, childActivityByParentId };
  }, [chats, blockedChatIdSet, machineChannels, linkedChannelsByParentId, liveActivity]);
}
