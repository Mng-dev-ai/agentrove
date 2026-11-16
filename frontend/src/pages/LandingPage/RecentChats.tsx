import { useMemo } from 'react';
import clsx from 'clsx';
import type { Chat } from '@/types/chat.types';
import { useStreamStore } from '@/store/streamStore';
import { useBlockedChatIds } from '@/hooks/useBlockedChatIds';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { getRelativeTime } from '@/utils/date';
import { stripMarkdownTitle } from '@/utils/format';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import { Server } from 'lucide-react';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { ChatStatusDot } from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { chatStatusTone, CHAT_STATUS_LABEL } from '@/utils/message';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner/AsciiSpinner';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Button } from '@/components/ui/primitives/Button/Button';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { useChatAgentKind } from '@/hooks/useChatAgentKind';
import type { ChatStatusTone } from '@/utils/message';
import styles from './RecentChats.module.scss';

const MAX_RECENT_CHATS = 4;

export interface RecentChatsProps {
  chats: Chat[];
  workspaceBadgeById: Map<string, WorkspaceBadge>;
  onChatSelect: (chatId: string) => void;
}

interface RecentChatRowProps {
  chat: Chat;
  title: string;
  meta: string;
  isRemote: boolean;
  status: ChatStatusTone | null;
  onSelect: (chatId: string) => void;
}

function RecentChatRow({ chat, title, meta, isRemote, status, onSelect }: RecentChatRowProps) {
  const agentKind = useChatAgentKind(chat.id, chat.session_agent_kind, chat.last_model_id);
  const showSpinner = status === 'running';
  const statusTone = showSpinner ? null : status;
  const statusSlot =
    agentKind || status ? (
      <span className={styles['status-slot']}>
        {showSpinner ? (
          <AsciiSpinner className={styles.spinner} />
        ) : (
          agentKind && <ProviderIcon agentKind={agentKind} className={styles['provider-icon']} />
        )}
        {statusTone && (
          <ChatStatusDot
            tone={statusTone}
            className={clsx(agentKind && styles['status-corner'])}
            ringClassName={styles['status-ring']}
          />
        )}
      </span>
    ) : null;
  return (
    <Button
      type="button"
      variant="unstyled"
      onClick={() => onSelect(chat.id)}
      className={styles.row}
    >
      {status && statusSlot ? (
        <FloatingTooltip content={CHAT_STATUS_LABEL[status]}>{statusSlot}</FloatingTooltip>
      ) : (
        statusSlot
      )}
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>
          {isRemote && (
            <Server size={12} aria-label="Remote machine" className={styles['cloud-icon']} />
          )}
          {meta}
        </span>
      </span>
      <span className={styles.time}>{getRelativeTime(chat.updated_at)}</span>
    </Button>
  );
}

export function RecentChats({ chats, workspaceBadgeById, onChatSelect }: RecentChatsProps) {
  const activeStreamMetadata = useStreamStore((state) => state.activeStreamMetadata);
  const lastToolTitleByChatId = useStreamStore((state) => state.lastToolTitleByChatId);
  const completedChatIds = useStreamStore((state) => state.completedChatIds);
  // Blocked on plan/permission approval or an agent question form.
  const blockedChatIds = useBlockedChatIds();
  // Recents only mount when authenticated.
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
          // Same tone order as sidebar/tabs; no open chat, so unread is never suppressed.
          const status = chatStatusTone({
            blocked: blockedChatIds.has(chat.id),
            streaming: streamingChatIds.has(chat.id),
            completed: completedChatIds.has(chat.id),
            unread: chat.unread,
          });
          const workspaceBadge = workspaceBadgeById.get(chat.workspace_id);
          const baseTitle = stripMarkdownTitle(chat.title);
          return (
            <RecentChatRow
              key={chat.id}
              chat={chat}
              title={
                status === 'running' ? (lastToolTitleByChatId.get(chat.id) ?? baseTitle) : baseTitle
              }
              meta={[workspaceBadge?.name, modelLabel(chat)].filter(Boolean).join(' · ')}
              isRemote={!!workspaceBadge && workspaceBadge.machineId !== LOCAL_MACHINE_ID}
              status={status}
              onSelect={onChatSelect}
            />
          );
        })}
      </div>
    </div>
  );
}
