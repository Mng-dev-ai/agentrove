import type { Chat } from '@/types/chat.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import { SidebarChatItem } from './SidebarChatItem';
import { SubThreadList } from './SubThreadList';

// Selection + handler bundle every chat row needs, threaded through the pinned and
// recent sections unchanged. Kept as one object so sections forward it instead of
// re-listing a dozen props.
export interface ChatRowProps {
  selectedChatId: string | null;
  secondaryChatId: string | null;
  hoveredChatId: string | null;
  dropdownChatId: string | null;
  streamingChatIdSet: Set<string>;
  blockedChatIdSet: Set<string>;
  completedChatIdSet: Set<string>;
  workspaceBadgeById: Map<string, WorkspaceBadge>;
  onChatSelect: (chatId: string) => void;
  onOpenInSplit?: (chatId: string) => void;
  onDropdownClick: (e: React.MouseEvent<HTMLButtonElement>, chat: Chat) => void;
  onWorkspaceBadgeClick: (e: React.MouseEvent<HTMLButtonElement>, workspaceId: string) => void;
  onMouseEnter: (chatId: string) => void;
  onMouseLeave: () => void;
  expandedSubThreads: Set<string>;
  onToggleSubThreads: (chatId: string) => void;
}

// One chat row: the item plus its expanded sub-thread list.
export function SidebarChatRow({ chat, rowProps }: { chat: Chat; rowProps: ChatRowProps }) {
  const {
    selectedChatId,
    secondaryChatId,
    hoveredChatId,
    dropdownChatId,
    streamingChatIdSet,
    blockedChatIdSet,
    completedChatIdSet,
    workspaceBadgeById,
    onChatSelect,
    onOpenInSplit,
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
        isActive={chat.id === selectedChatId || chat.id === secondaryChatId}
        isHovered={hoveredChatId === chat.id}
        isDropdownOpen={dropdownChatId === chat.id}
        isChatStreaming={streamingChatIdSet.has(chat.id)}
        isChatBlocked={blockedChatIdSet.has(chat.id)}
        isChatCompleted={completedChatIdSet.has(chat.id)}
        workspaceBadge={workspaceBadgeById.get(chat.workspace_id)}
        onSelect={onChatSelect}
        onOpenInSplit={onOpenInSplit}
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
          secondaryChatId={secondaryChatId}
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
