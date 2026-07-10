import type { Chat } from '@/types/chat.types';
import type { SidebarGroupBy, SidebarStatusFilter } from '@/store/sidebarFilters';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';

export interface SidebarChatSection {
  key: string;
  label: string | null;
  chats: Chat[];
}

// Group order mirrors the row badge precedence in SidebarChatItem, so a chat
// lands in the group matching its visible badge; most urgent groups first.
const STATUS_GROUP_ORDER: { key: SidebarStatusFilter | 'other'; label: string }[] = [
  { key: 'needs-you', label: 'Needs you' },
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Done' },
  { key: 'unread', label: 'Unread' },
  { key: 'other', label: 'Other' },
];

interface GroupingContext {
  groupBy: SidebarGroupBy;
  visibleRecentChats: Chat[];
  workspaceBadgeById: Map<string, WorkspaceBadge>;
  blockedChatIdSet: Set<string>;
  streamingChatIdSet: Set<string>;
  completedChatIds: Set<string>;
}

// Always returns a sections list so the JSX renders one shape — ungrouped is a
// single headerless section. Groups keep the flat list's recency order:
// workspace groups appear in order of their most recent chat; status groups
// follow badge urgency. Pinned stays flat — it's a small, user-curated list.
export function buildRecentChatSections({
  groupBy,
  visibleRecentChats,
  workspaceBadgeById,
  blockedChatIdSet,
  streamingChatIdSet,
  completedChatIds,
}: GroupingContext): SidebarChatSection[] {
  if (groupBy === 'workspace') {
    const groups = new Map<string, SidebarChatSection>();
    for (const chat of visibleRecentChats) {
      let group = groups.get(chat.workspace_id);
      if (!group) {
        group = {
          key: chat.workspace_id,
          // Briefly unresolved while the cloud workspaces query loads
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
    const byStatus = new Map<SidebarStatusFilter | 'other', Chat[]>();
    for (const chat of visibleRecentChats) {
      const status = blockedChatIdSet.has(chat.id)
        ? 'needs-you'
        : streamingChatIdSet.has(chat.id)
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
