import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  ChevronLeft,
  MessageCircleQuestion,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog/ConfirmDialog';
import {
  useChatQuery,
  useDeleteChatMutation,
  usePromoteChatMutation,
} from '@/hooks/queries/useChatQueries';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatSessionContext } from '@/hooks/useChatSessionContext';
import { Chat as ChatComponent } from '@/components/chat/chat-window/Chat';
import { useUIStore } from '@/store/uiStore';
import { stripMarkdownTitle } from '@/utils/format';
import type { Chat } from '@/types/chat.types';
import styles from './SideQuestion.module.scss';

export function SideQuestionPane({ chat }: { chat: Chat }) {
  const { state } = useChatSessionContext();
  return (
    <div className={styles['side-pane']}>
      <SideQuestionHeader chat={chat} running={state.isStreaming || state.isLoading} />
      <ChatComponent />
    </div>
  );
}

interface SideQuestionHeaderProps {
  chat: Chat;
  running: boolean;
}

function SideQuestionHeader({ chat, running }: SideQuestionHeaderProps) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { data: parent } = useChatQuery(chat.parent_chat_id ?? undefined);
  const promote = usePromoteChatMutation();
  const deleteChat = useDeleteChatMutation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handlePromote = async () => {
    try {
      await promote.mutateAsync(chat.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to promote side question');
      return;
    }
    useUIStore.getState().closeSplitChat(chat.id);
    navigate(`/chat/${chat.id}`);
  };

  const handleDelete = async () => {
    try {
      await deleteChat.mutateAsync(chat.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete side question');
      return;
    }
    useUIStore.getState().closeSplitChat(chat.id);
  };

  return (
    <div className={styles.header}>
      {isMobile && parent && (
        <Button
          variant="unstyled"
          type="button"
          className={styles.back}
          onClick={() => useUIStore.getState().focusTile('agent:primary')}
        >
          <ChevronLeft className={styles['action-icon']} />
          <span className={styles['back-label']}>{stripMarkdownTitle(parent.title)}</span>
        </Button>
      )}
      <div className={styles['header-row']}>
        <div className={styles['title-row']}>
          <MessageCircleQuestion className={styles['title-icon']} />
          {!isMobile && <span className={styles['title-prefix']}>Side question:</span>}
          <span className={styles.title}>{stripMarkdownTitle(chat.title)}</span>
        </div>
        <div className={styles.actions}>
          <PaneAction
            icon={ArrowUpRight}
            label="Promote to chat"
            tooltip={running ? 'Available when the side question finishes' : 'Promote to chat'}
            disabled={running || promote.isPending}
            onClick={() => void handlePromote()}
          />
          <PaneAction
            icon={Trash2}
            label="Delete side question"
            tooltip="Delete side question"
            onClick={() => setConfirmingDelete(true)}
          />
          <PaneAction
            icon={X}
            label="Close pane"
            tooltip="Close pane"
            onClick={() => useUIStore.getState().closeSplitChat(chat.id)}
          />
        </div>
      </div>
      <ConfirmDialog
        destructive
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={() => void handleDelete()}
        title="Delete Side Question"
        message="Are you sure you want to delete this side question? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
}

interface PaneActionProps {
  icon: LucideIcon;
  label: string;
  tooltip: string;
  disabled?: boolean;
  onClick: () => void;
}

function PaneAction({ icon: Icon, label, tooltip, disabled = false, onClick }: PaneActionProps) {
  return (
    <FloatingTooltip content={tooltip} className={styles['action-slot']}>
      <Button
        variant="unstyled"
        type="button"
        className={styles.action}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon className={styles['action-icon']} />
      </Button>
    </FloatingTooltip>
  );
}
