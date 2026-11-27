import type { AgentKind, Chat } from '@/types/chat.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import type { MachineBadge } from './SidebarChatItem';
import { SidebarChatItem } from './SidebarChatItem';
import { SidebarChannelItem } from './SidebarChannelItem';
import type { MachineChannel } from './sidebarGrouping';
import { SubThreadList } from './SubThreadList';
import type { SidebarChannelActions } from './useSidebarChannelActions';
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
  machineBadge: (machineId: string) => MachineBadge | undefined;
  machineBadgeForChat: (chatId: string) => MachineBadge | undefined;
  channelAgentKinds: (entry: MachineChannel) => AgentKind[];
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
  channelActions: SidebarChannelActions;
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
    channelActions,
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
          channelActions={channelActions}
          selectedChatId={selectedChatId}
          splitChatIds={splitChatIds}
          dropdownChatId={dropdownChatId}
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

export function SidebarChannelRow({
  entry,
  rowProps,
}: {
  entry: MachineChannel;
  rowProps: ChatRowProps;
}) {
  const { channel, machineId } = entry;
  const { channelActions, selectedChannelId } = rowProps;
  return (
    <SidebarChannelItem
      channel={channel}
      agentKinds={rowProps.channelAgentKinds(entry)}
      machineBadge={rowProps.machineBadge(machineId)}
      isActive={channel.id === selectedChannelId}
      isCompleted={channelActions.completedChannelIds.has(channel.id)}
      isDropdownOpen={channelActions.openMenuChannelId === channel.id}
      onSelect={channelActions.handleChannelSelect}
      onDropdownClick={channelActions.handleChannelDropdownClick}
    />
  );
}
