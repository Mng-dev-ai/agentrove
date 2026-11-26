import type { Chat } from '@/types/chat.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import type { MachineBadge } from './SidebarChatItem';
import { SidebarChatItem } from './SidebarChatItem';
import { SubThreadList } from './SubThreadList';
import type { ChildActivity } from './useSidebarActivity';

// Bundle row handlers/state so pinned and recent sections forward one object.
export interface ChatRowProps {
  selectedChatId: string | null;
  splitChatIds: string[];
  hoveredChatId: string | null;
  dropdownChatId: string | null;
  streamingChatIdSet: Set<string>;
  blockedChatIdSet: Set<string>;
  completedChatIdSet: Set<string>;
  workspaceBadgeById: Map<string, WorkspaceBadge>;
  machineBadgeForChat: (chatId: string) => MachineBadge | undefined;
  onChatSelect: (chatId: string) => void;
  onOpenInSplit?: (chatId: string) => void;
  canOpenChatInSplit: (chatId: string) => boolean;
  onDropdownClick: (e: React.MouseEvent<HTMLButtonElement>, chat: Chat) => void;
  onMouseEnter: (chatId: string) => void;
  onMouseLeave: () => void;
  expandedSubThreads: Set<string>;
  onToggleSubThreads: (chatId: string) => void;
  childActivityByParentId: Map<string, ChildActivity>;
}

interface SidebarChatRowProps {
  chat: Chat;
  rowProps: ChatRowProps;
  // The flat activity list already lists active sub-threads, so its rows don't expand
  isFlat?: boolean;
  parentTitle?: string;
}

export function SidebarChatRow({
  chat,
  rowProps,
  isFlat = false,
  parentTitle,
}: SidebarChatRowProps) {
  const {
    selectedChatId,
    splitChatIds,
    hoveredChatId,
    dropdownChatId,
    streamingChatIdSet,
    blockedChatIdSet,
    completedChatIdSet,
    workspaceBadgeById,
    machineBadgeForChat,
    onChatSelect,
    onOpenInSplit,
    canOpenChatInSplit,
    onDropdownClick,
    onMouseEnter,
    onMouseLeave,
    expandedSubThreads,
    onToggleSubThreads,
    childActivityByParentId,
  } = rowProps;
  const hasSubThreads = !isFlat && chat.sub_thread_count > 0;
  const isExpanded = hasSubThreads && expandedSubThreads.has(chat.id);

  return (
    <div>
      <SidebarChatItem
        chat={chat}
        isSelected={chat.id === selectedChatId}
        isActive={chat.id === selectedChatId || splitChatIds.includes(chat.id)}
        isHovered={hoveredChatId === chat.id}
        isDropdownOpen={dropdownChatId === chat.id}
        isChatStreaming={streamingChatIdSet.has(chat.id)}
        isChatBlocked={blockedChatIdSet.has(chat.id)}
        isChatCompleted={completedChatIdSet.has(chat.id)}
        workspaceBadge={workspaceBadgeById.get(chat.workspace_id)}
        machineBadge={machineBadgeForChat(chat.id)}
        onSelect={onChatSelect}
        onOpenInSplit={onOpenInSplit}
        canOpenInSplit={canOpenChatInSplit(chat.id)}
        onDropdownClick={onDropdownClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onToggleSubThreads={hasSubThreads ? onToggleSubThreads : undefined}
        isSubThreadsExpanded={hasSubThreads ? isExpanded : undefined}
        childActivity={
          hasSubThreads && !isExpanded ? childActivityByParentId.get(chat.id) : undefined
        }
        parentTitle={parentTitle}
      />
      {isExpanded && (
        <SubThreadList
          parentChatId={chat.id}
          selectedChatId={selectedChatId}
          splitChatIds={splitChatIds}
          onSelect={onChatSelect}
          onDropdownClick={onDropdownClick}
          streamingChatIdSet={streamingChatIdSet}
          blockedChatIdSet={blockedChatIdSet}
          completedChatIdSet={completedChatIdSet}
        />
      )}
    </div>
  );
}
