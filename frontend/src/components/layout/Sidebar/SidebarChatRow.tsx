import type { Chat } from '@/types/chat.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import { SidebarChatItem } from './SidebarChatItem';
import { SubThreadList } from './SubThreadList';

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
  onChatSelect: (chatId: string) => void;
  onOpenInSplit?: (chatId: string) => void;
  canOpenChatInSplit: (chatId: string) => boolean;
  onDropdownClick: (e: React.MouseEvent<HTMLButtonElement>, chat: Chat) => void;
  onWorkspaceBadgeClick: (e: React.MouseEvent<HTMLButtonElement>, workspaceId: string) => void;
  onMouseEnter: (chatId: string) => void;
  onMouseLeave: () => void;
  expandedSubThreads: Set<string>;
  onToggleSubThreads: (chatId: string) => void;
}

export function SidebarChatRow({ chat, rowProps }: { chat: Chat; rowProps: ChatRowProps }) {
  const {
    selectedChatId,
    splitChatIds,
    hoveredChatId,
    dropdownChatId,
    streamingChatIdSet,
    blockedChatIdSet,
    completedChatIdSet,
    workspaceBadgeById,
    onChatSelect,
    onOpenInSplit,
    canOpenChatInSplit,
    onDropdownClick,
    onWorkspaceBadgeClick,
    onMouseEnter,
    onMouseLeave,
    expandedSubThreads,
    onToggleSubThreads,
  } = rowProps;
  const hasSubThreads = chat.sub_thread_count > 0;

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
        onSelect={onChatSelect}
        onOpenInSplit={onOpenInSplit}
        canOpenInSplit={canOpenChatInSplit(chat.id)}
        onDropdownClick={onDropdownClick}
        onWorkspaceBadgeClick={onWorkspaceBadgeClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onToggleSubThreads={hasSubThreads ? onToggleSubThreads : undefined}
        isSubThreadsExpanded={hasSubThreads ? expandedSubThreads.has(chat.id) : undefined}
      />
      {hasSubThreads && expandedSubThreads.has(chat.id) && (
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
