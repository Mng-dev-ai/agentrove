import { memo, type Ref } from 'react';
import toast from 'react-hot-toast';
import {
  CornerLeftUp,
  Copy,
  Edit2,
  Folder,
  GitFork,
  Trash2,
  Pin,
  PinOff,
  SplitSquareHorizontal,
} from 'lucide-react';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { useChatMachineId } from '@/store/machineOrigin';
import { useStreamStore } from '@/store/streamStore';
import type { Chat } from '@/types/chat.types';
import { canForkChat } from '@/utils/sideQuestion';
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
  onConvertToThread: (chat: Chat) => void;
  convertPending: boolean;
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
  onConvertToThread,
  convertPending,
  onWorkspaceOptions,
  onOpenInSplit,
  splitDisabled = false,
  onClose,
}: ChatDropdownProps) {
  const isPinned = !!chat.pinned_at;
  const isSubThread = !!chat.parent_chat_id;
  const model = useModelMap({ machineId: useChatMachineId(chat.id) }).get(chat.last_model_id ?? '');
  const canFork = canForkChat(chat, model);
  const isRunning = useStreamStore((s) =>
    s.activeStreamMetadata.some((stream) => stream.chatId === chat.id),
  );

  const handleCopyId = async () => {
    onClose?.();
    try {
      await navigator.clipboard.writeText(chat.id);
      toast.success('Chat ID copied');
    } catch {
      toast.error('Failed to copy chat ID');
    }
  };

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
      {isSubThread && (
        <SidebarMenuItem
          icon={CornerLeftUp}
          onClick={() => onConvertToThread(chat)}
          disabled={isRunning || convertPending}
        >
          Convert to thread
        </SidebarMenuItem>
      )}
      <SidebarMenuItem icon={Folder} onClick={() => onWorkspaceOptions(chat)}>
        Workspace
      </SidebarMenuItem>
      <SidebarMenuItem icon={Edit2} onClick={() => onRename(chat)}>
        Rename
      </SidebarMenuItem>
      <SidebarMenuItem icon={Copy} onClick={handleCopyId}>
        Copy chat ID
      </SidebarMenuItem>
      <SidebarMenuItem icon={Trash2} onClick={() => onDelete(chat.id)} danger>
        Delete
      </SidebarMenuItem>
    </SidebarMenu>
  );
});
