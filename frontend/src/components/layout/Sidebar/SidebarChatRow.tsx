import type { MouseEvent } from 'react';
import type { Channel } from '@/types/channel.types';
import type { Chat } from '@/types/chat.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import type { MachineBadge } from './SidebarChatItem';
import { SidebarChatItem } from './SidebarChatItem';
import type { MachineChannel } from './sidebarGrouping';
import { SubThreadList } from './SubThreadList';
import type { ChildActivity } from './useSidebarActivity';

const NO_LINKED_CHANNELS: MachineChannel[] = [];

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
  linkedChannelsByParentId: Map<string, MachineChannel[]>;
  selectedChannelId: string | null;
  openMenuChannelId: string | null;
  completedChannelIds: ReadonlySet<string>;
  onChannelSelect: (channelId: string) => void;
  onChannelDropdownClick: (e: MouseEvent<HTMLButtonElement>, channel: Channel) => void;
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
    linkedChannelsByParentId,
    selectedChannelId,
    openMenuChannelId,
    completedChannelIds,
    onChannelSelect,
    onChannelDropdownClick,
  } = rowProps;
  const linkedChannels = isFlat
    ? NO_LINKED_CHANNELS
    : (linkedChannelsByParentId.get(chat.id) ?? NO_LINKED_CHANNELS);
  const hasSubThreads = !isFlat && (chat.sub_thread_count > 0 || linkedChannels.length > 0);
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
        linkedChannelCount={linkedChannels.length}
        childActivity={
          hasSubThreads && !isExpanded ? childActivityByParentId.get(chat.id) : undefined
        }
        parentTitle={parentTitle}
      />
      {isExpanded && (
        <SubThreadList
          parentChatId={chat.id}
          hasSubThreads={chat.sub_thread_count > 0}
          linkedChannels={linkedChannels}
          selectedChannelId={selectedChannelId}
          openMenuChannelId={openMenuChannelId}
          completedChannelIds={completedChannelIds}
          onChannelSelect={onChannelSelect}
          onChannelDropdownClick={onChannelDropdownClick}
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
