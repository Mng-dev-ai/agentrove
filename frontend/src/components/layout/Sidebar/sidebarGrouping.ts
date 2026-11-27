import type { Channel, ChannelMemberActivity } from '@/types/channel.types';
import type { Chat } from '@/types/chat.types';
import type {
  SidebarActivityKind,
  SidebarGroupBy,
  SidebarStatusFilter,
  SidebarThreadType,
} from '@/store/sidebarFilters';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import { formatDayLabel } from '@/utils/date';

export interface MachineChannel {
  channel: Channel;
  machineId: string;
}

export type SidebarThread =
  | { kind: 'chat'; chat: Chat }
  | { kind: 'channel'; channel: Channel; machineId: string };

export interface SidebarSection {
  key: string;
  label: string | null;
  threads: SidebarThread[];
}

type RecentStatusGroup = Exclude<SidebarStatusFilter, 'needs-you'> | 'other';

// Group order mirrors the row badge precedence in SidebarChatItem, so a thread
// lands in the group matching its visible badge; most urgent groups first.
const STATUS_GROUP_ORDER: { key: RecentStatusGroup; label: string }[] = [
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Done' },
  { key: 'unread', label: 'Unread' },
  { key: 'other', label: 'Other' },
];

export function threadId(thread: SidebarThread): string {
  return thread.kind === 'chat' ? thread.chat.id : thread.channel.id;
}

export function threadUpdatedAt(thread: SidebarThread): string {
  return thread.kind === 'chat' ? thread.chat.updated_at : thread.channel.updated_at;
}

function threadPinnedAt(thread: SidebarThread): number {
  const pinnedAt = thread.kind === 'chat' ? thread.chat.pinned_at : thread.channel.pinned_at;
  return pinnedAt ? Date.parse(pinnedAt) : 0;
}

function threadWorkspaceId(thread: SidebarThread): string {
  return thread.kind === 'chat' ? thread.chat.workspace_id : thread.channel.workspace_id;
}

function isThreadUnread(thread: SidebarThread): boolean {
  return thread.kind === 'chat' ? thread.chat.unread : !!thread.channel.unread;
}

interface MergeContext {
  pinnedChats: Chat[];
  recentChats: Chat[];
  // Top-level channels; channels load whole, chats page by page
  channels: MachineChannel[];
  // updated_at of the oldest loaded recent chat while more chat pages remain
  recentsFloor: string | null;
  selectedChannelId: string | null;
  threadType: SidebarThreadType;
}

// One list of both kinds. An unpinned channel older than the oldest loaded chat waits for
// that page, so a later page never slots chats above it; the open channel always shows.
export function mergeSidebarThreads({
  pinnedChats,
  recentChats,
  channels,
  recentsFloor,
  selectedChannelId,
  threadType,
}: MergeContext): { pinned: SidebarThread[]; recents: SidebarThread[] } {
  const chatThreads: SidebarThread[] =
    threadType === 'group' ? [] : recentChats.map((chat) => ({ kind: 'chat', chat }));
  const pinnedChatThreads: SidebarThread[] =
    threadType === 'group' ? [] : pinnedChats.map((chat) => ({ kind: 'chat', chat }));
  const channelThreads: SidebarThread[] =
    threadType === 'single'
      ? []
      : channels.map(({ channel, machineId }) => ({ kind: 'channel', channel, machineId }));
  // Without chats in the list, no later page can reorder it
  const floor = recentsFloor && threadType !== 'group' ? Date.parse(recentsFloor) : -Infinity;
  const recentChannels = channelThreads.filter(
    (thread) =>
      thread.kind === 'channel' &&
      !thread.channel.pinned_at &&
      (thread.channel.id === selectedChannelId || Date.parse(thread.channel.updated_at) >= floor),
  );
  const pinnedChannels = channelThreads.filter(
    (thread) => thread.kind === 'channel' && thread.channel.pinned_at,
  );
  const byUpdatedAt = (a: SidebarThread, b: SidebarThread) =>
    Date.parse(threadUpdatedAt(b)) - Date.parse(threadUpdatedAt(a));
  return {
    pinned: [...pinnedChatThreads, ...pinnedChannels].sort(
      (a, b) => threadPinnedAt(b) - threadPinnedAt(a),
    ),
    recents: [...chatThreads, ...recentChannels].sort(byUpdatedAt),
  };
}

interface GroupingContext {
  groupBy: SidebarGroupBy;
  visibleRecentThreads: SidebarThread[];
  workspaceBadgeById: Map<string, WorkspaceBadge>;
  // Chat and channel ids share one id space
  runningIds: Set<string>;
  completedIds: Set<string>;
}

// Always returns a sections list so the JSX renders one shape — ungrouped is a
// single headerless section. Groups keep the flat list's recency order:
// date and workspace groups appear in order of their most recent thread; status
// groups follow badge urgency. Pinned stays flat — it's a small, curated list.
export function buildRecentSections({
  groupBy,
  visibleRecentThreads,
  workspaceBadgeById,
  runningIds,
  completedIds,
}: GroupingContext): SidebarSection[] {
  if (groupBy === 'date') {
    const groups = new Map<number, SidebarSection>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    for (const thread of visibleRecentThreads) {
      const threadDate = new Date(threadUpdatedAt(thread));
      threadDate.setHours(0, 0, 0, 0);
      const key = threadDate.getTime();
      let group = groups.get(key);
      if (!group) {
        const label =
          key === today.getTime()
            ? 'Today'
            : key === yesterday.getTime()
              ? 'Yesterday'
              : formatDayLabel(threadDate, today);
        group = { key: String(key), label, threads: [] };
        groups.set(key, group);
      }
      group.threads.push(thread);
    }
    return Array.from(groups.values());
  }
  if (groupBy === 'workspace') {
    const groups = new Map<string, SidebarSection>();
    for (const thread of visibleRecentThreads) {
      const workspaceId = threadWorkspaceId(thread);
      let group = groups.get(workspaceId);
      if (!group) {
        group = {
          key: workspaceId,
          // Briefly unresolved while a machine's workspaces query loads
          label: workspaceBadgeById.get(workspaceId)?.name ?? 'Unknown workspace',
          threads: [],
        };
        groups.set(workspaceId, group);
      }
      group.threads.push(thread);
    }
    return Array.from(groups.values());
  }
  if (groupBy === 'status') {
    const byStatus = new Map<RecentStatusGroup, SidebarThread[]>();
    for (const thread of visibleRecentThreads) {
      const id = threadId(thread);
      const status = runningIds.has(id)
        ? 'running'
        : completedIds.has(id)
          ? 'done'
          : isThreadUnread(thread)
            ? 'unread'
            : 'other';
      const list = byStatus.get(status);
      if (list) list.push(thread);
      else byStatus.set(status, [thread]);
    }
    return STATUS_GROUP_ORDER.flatMap(({ key, label }) => {
      const threads = byStatus.get(key);
      return threads ? [{ key, label, threads }] : [];
    });
  }
  return [{ key: 'all', label: null, threads: visibleRecentThreads }];
}

// A linked channel nests under its parent chat only while that chat's row is rendered
// on the same machine; otherwise it stays top-level, so it is always reachable once.
export function partitionLinkedChannels(
  machineChannels: MachineChannel[],
  renderedParentMachineById: Map<string, string>,
): { linkedByParentId: Map<string, MachineChannel[]>; topLevel: MachineChannel[] } {
  const linkedByParentId = new Map<string, MachineChannel[]>();
  const topLevel: MachineChannel[] = [];
  for (const entry of machineChannels) {
    const parentId = entry.channel.parent_chat_id;
    if (!parentId || renderedParentMachineById.get(parentId) !== entry.machineId) {
      topLevel.push(entry);
      continue;
    }
    const linked = linkedByParentId.get(parentId);
    if (linked) linked.push(entry);
    else linkedByParentId.set(parentId, [entry]);
  }
  return { linkedByParentId, topLevel };
}

// A channel counts once: needs-you while any member waits on the user, else running
// while any member has a turn going.
export function channelActivityKind(activity: ChannelMemberActivity): SidebarActivityKind | null {
  if (activity.waiting_member_ids.length > 0) return 'needs-you';
  if (activity.member_ids.length > 0) return 'running';
  return null;
}
