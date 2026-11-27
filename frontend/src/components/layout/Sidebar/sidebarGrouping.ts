import type { Channel } from '@/types/channel.types';
import type { Chat } from '@/types/chat.types';
import type { SidebarGroupBy, SidebarStatusFilter } from '@/store/sidebarFilters';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import { formatDayLabel } from '@/utils/date';

export interface MachineChannel {
  channel: Channel;
  machineId: string;
}

export interface SidebarChatSection {
  key: string;
  label: string | null;
  chats: Chat[];
}

type RecentStatusGroup = Exclude<SidebarStatusFilter, 'needs-you'> | 'other';

// Group order mirrors the row badge precedence in SidebarChatItem, so a chat
// lands in the group matching its visible badge; most urgent groups first.
const STATUS_GROUP_ORDER: { key: RecentStatusGroup; label: string }[] = [
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Done' },
  { key: 'unread', label: 'Unread' },
  { key: 'other', label: 'Other' },
];

interface GroupingContext {
  groupBy: SidebarGroupBy;
  visibleRecentChats: Chat[];
  workspaceBadgeById: Map<string, WorkspaceBadge>;
  streamingChatIdSet: Set<string>;
  completedChatIds: Set<string>;
}

// Always returns a sections list so the JSX renders one shape — ungrouped is a
// single headerless section. Groups keep the flat list's recency order:
// date and workspace groups appear in order of their most recent chat; status
// groups follow badge urgency. Pinned stays flat — it's a small, curated list.
export function buildRecentChatSections({
  groupBy,
  visibleRecentChats,
  workspaceBadgeById,
  streamingChatIdSet,
  completedChatIds,
}: GroupingContext): SidebarChatSection[] {
  if (groupBy === 'date') {
    const groups = new Map<number, SidebarChatSection>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    for (const chat of visibleRecentChats) {
      const chatDate = new Date(chat.updated_at);
      chatDate.setHours(0, 0, 0, 0);
      const key = chatDate.getTime();
      let group = groups.get(key);
      if (!group) {
        const label =
          key === today.getTime()
            ? 'Today'
            : key === yesterday.getTime()
              ? 'Yesterday'
              : formatDayLabel(chatDate, today);
        group = { key: String(key), label, chats: [] };
        groups.set(key, group);
      }
      group.chats.push(chat);
    }
    return Array.from(groups.values());
  }
  if (groupBy === 'workspace') {
    const groups = new Map<string, SidebarChatSection>();
    for (const chat of visibleRecentChats) {
      let group = groups.get(chat.workspace_id);
      if (!group) {
        group = {
          key: chat.workspace_id,
          // Briefly unresolved while a machine's workspaces query loads
          label: workspaceBadgeById.get(chat.workspace_id)?.name ?? 'Unknown workspace',
          chats: [],
        };
        groups.set(chat.workspace_id, group);
      }
      group.chats.push(chat);
    }
    return Array.from(groups.values());
  }
  if (groupBy === 'status') {
    const byStatus = new Map<RecentStatusGroup, Chat[]>();
    for (const chat of visibleRecentChats) {
      const status = streamingChatIdSet.has(chat.id)
        ? 'running'
        : completedChatIds.has(chat.id)
          ? 'done'
          : chat.unread
            ? 'unread'
            : 'other';
      const list = byStatus.get(status);
      if (list) list.push(chat);
      else byStatus.set(status, [chat]);
    }
    return STATUS_GROUP_ORDER.flatMap(({ key, label }) => {
      const chats = byStatus.get(key);
      return chats ? [{ key, label, chats }] : [];
    });
  }
  return [{ key: 'all', label: null, chats: visibleRecentChats }];
}

// A collapsed section still renders its open chats, so the current selection never disappears
export function renderedSectionChats(
  chats: Chat[],
  isCollapsed: boolean,
  openChatIds: { selectedChatId: string | null; splitChatIds: string[] },
): Chat[] {
  if (!isCollapsed) return chats;
  return chats.filter(
    (chat) => chat.id === openChatIds.selectedChatId || openChatIds.splitChatIds.includes(chat.id),
  );
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
