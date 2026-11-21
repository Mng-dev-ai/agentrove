import { memo, type Ref } from 'react';
import { Edit2, Folder, GitFork, Trash2, Pin, PinOff, SplitSquareHorizontal } from 'lucide-react';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { useChatMachineId } from '@/store/machineOrigin';
import type { Chat } from '@/types/chat.types';
import { SidebarMenu, SidebarMenuItem } from './SidebarMenu';
import styles from './ChatDropdown.module.scss';

interface ChatDropdownProps {
  ref?: Ref<HTMLDivElement>;
  chat: Chat;
  position: { top: number; left: number };
  onRename: (chat: Chat) => void;
  onDelete: (chatId: string) => void;
  onTogglePin: (chat: Chat) => void;
  onFork: (chat: Chat) => void;
  forkPending: boolean;
  onWorkspaceOptions: (chat: Chat) => void;
  onOpenInSplit?: (chatId: string) => void;
  splitDisabled?: boolean;
  onClose?: () => void;
}

export const ChatDropdown = memo(function ChatDropdown({
  ref,
  chat,
  position,
  onRename,
  onDelete,
  onTogglePin,
  onFork,
  forkPending,
  onWorkspaceOptions,
  onOpenInSplit,
  splitDisabled = false,
  onClose,
}: ChatDropdownProps) {
  const isPinned = !!chat.pinned_at;
  const isSubThread = !!chat.parent_chat_id;
  const model = useModelMap({ machineId: useChatMachineId(chat.id) }).get(chat.last_model_id ?? '');
  // The fork copies the agent's own session, so the chat must have run on that agent.
  const canFork =
    !chat.channel_id && !!model?.supports_fork && chat.session_agent_kind === model.agent_kind;

  return (
    <SidebarMenu ref={ref} position={position} onClose={onClose}>
      {!isSubThread && (
        <SidebarMenuItem icon={isPinned ? PinOff : Pin} onClick={() => onTogglePin(chat)}>
          {isPinned ? 'Unpin' : 'Pin'}
        </SidebarMenuItem>
      )}
      {onOpenInSplit && (
        <FloatingTooltip
          content={splitDisabled ? 'Split view is full (max 4 chats)' : ''}
          className={styles['split-tooltip']}
        >
          <SidebarMenuItem
            icon={SplitSquareHorizontal}
            onClick={() => onOpenInSplit(chat.id)}
            disabled={splitDisabled}
          >
            Open in split
          </SidebarMenuItem>
        </FloatingTooltip>
      )}
      {canFork && (
        <SidebarMenuItem icon={GitFork} onClick={() => onFork(chat)} disabled={forkPending}>
          Fork
        </SidebarMenuItem>
      )}
      <SidebarMenuItem icon={Folder} onClick={() => onWorkspaceOptions(chat)}>
        Workspace
      </SidebarMenuItem>
      <SidebarMenuItem icon={Edit2} onClick={() => onRename(chat)}>
        Rename
      </SidebarMenuItem>
      <SidebarMenuItem icon={Trash2} onClick={() => onDelete(chat.id)} danger>
        Delete
      </SidebarMenuItem>
    </SidebarMenu>
  );
});
