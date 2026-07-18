import { useMemo } from 'react';
import type { Chat } from '@/types/chat.types';
import { useStreamStore } from '@/store/streamStore';
import { usePermissionStore } from '@/store/permissionStore';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { formatRelativeTime } from '@/utils/date';
import { stripMarkdownTitle } from '@/utils/format';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import {
  ChatStatusDot,
  chatStatusTone,
  CHAT_STATUS_LABEL,
} from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner/AsciiSpinner';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './RecentChats.module.scss';

const MAX_RECENT_CHATS = 4;

export interface RecentChatsProps {
  chats: Chat[];
  workspaceBadgeById: Map<string, WorkspaceBadge>;
  onChatSelect: (chatId: string) => void;
}

export function RecentChats({ chats, workspaceBadgeById, onChatSelect }: RecentChatsProps) {
  const activeStreamMetadata = useStreamStore((state) => state.activeStreamMetadata);
  const completedChatIds = useStreamStore((state) => state.completedChatIds);
  // Empty queues are deleted from the store, so every remaining key is a chat
  // blocked on a plan/question/permission answer.
  const pendingRequests = usePermissionStore((state) => state.pendingRequests);
  // Recents only render when authenticated, so the models query is safe to enable.
  const modelMap = useModelMap();

  const streamingChatIds = useMemo(
    () => new Set(activeStreamMetadata.map((meta) => meta.chatId)),
    [activeStreamMetadata],
  );

  const modelLabel = (chat: Chat) =>
    (chat.last_model_id && modelMap.get(chat.last_model_id)?.name) || chat.session_agent_kind;

  return (
    <div className={styles.recents}>
      <div className={styles.header}>Jump back in</div>
      <div className={styles.list}>
        {chats.slice(0, MAX_RECENT_CHATS).map((chat) => {
          // Same tone precedence as the sidebar rows and chat tabs; no chat is
          // open on the landing page, so unread is never suppressed here.
          const status = chatStatusTone({
            blocked: pendingRequests.has(chat.id),
            streaming: streamingChatIds.has(chat.id),
            completed: completedChatIds.has(chat.id),
            unread: chat.unread,
          });
          const statusSlot = (
            <span className={styles['status-slot']}>
              {status === 'running' ? (
                <AsciiSpinner className={styles.spinner} />
              ) : status ? (
                <ChatStatusDot tone={status} />
              ) : null}
            </span>
          );
          const meta = [workspaceBadgeById.get(chat.workspace_id)?.name, modelLabel(chat)]
            .filter(Boolean)
            .join(' · ');
          return (
            <Button
              key={chat.id}
              type="button"
              variant="unstyled"
              onClick={() => onChatSelect(chat.id)}
              className={styles.row}
            >
              {status ? (
                <FloatingTooltip content={CHAT_STATUS_LABEL[status]}>{statusSlot}</FloatingTooltip>
              ) : (
                statusSlot
              )}
              <span className={styles.text}>
                <span className={styles.title}>{stripMarkdownTitle(chat.title)}</span>
                <span className={styles.meta}>{meta}</span>
              </span>
              <span className={styles.time}>{formatRelativeTime(chat.updated_at)}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
