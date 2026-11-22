import { useMemo, type ReactNode } from 'react';
import clsx from 'clsx';
import type { Chat } from '@/types/chat.types';
import type { Channel } from '@/types/channel.types';
import { useChannelActivity, useChannelStore } from '@/store/channelStore';
import { useStreamStore } from '@/store/streamStore';
import { useBlockedChatIds } from '@/hooks/useBlockedChatIds';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { getRelativeTime } from '@/utils/date';
import { stripMarkdownTitle } from '@/utils/format';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import { Hash, Server } from 'lucide-react';
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

const MAX_RECENT_ENTRIES = 4;

export type JumpBackInEntry =
  | { kind: 'chat'; chat: Chat }
  | { kind: 'channel'; channel: Channel; machineId: string };

export interface RecentChatsProps {
  entries: JumpBackInEntry[];
  workspaceBadgeById: Map<string, WorkspaceBadge>;
  onChatSelect: (chatId: string) => void;
  onChannelSelect: (channelId: string) => void;
}

interface RecentRowProps {
  id: string;
  leading: ReactNode;
  title: string;
  meta: string;
  isRemote: boolean;
  status: ChatStatusTone | null;
  updatedAt: string;
  onSelect: (id: string) => void;
}

function RecentRow({
  id,
  leading,
  title,
  meta,
  isRemote,
  status,
  updatedAt,
  onSelect,
}: RecentRowProps) {
  return (
    <Button type="button" variant="unstyled" onClick={() => onSelect(id)} className={styles.row}>
      {status && leading ? (
        <FloatingTooltip content={CHAT_STATUS_LABEL[status]}>{leading}</FloatingTooltip>
      ) : (
        leading
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
      <span className={styles.time}>{getRelativeTime(updatedAt)}</span>
    </Button>
  );
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
    <RecentRow
      id={chat.id}
      leading={statusSlot}
      title={title}
      meta={meta}
      isRemote={isRemote}
      status={status}
      updatedAt={chat.updated_at}
      onSelect={onSelect}
    />
  );
}

interface RecentChannelRowProps {
  channel: Channel;
  meta: string;
  isRemote: boolean;
  onSelect: (channelId: string) => void;
}

function RecentChannelRow({ channel, meta, isRemote, onSelect }: RecentChannelRowProps) {
  const activity = useChannelActivity(channel);
  const completed = useChannelStore((state) => state.completedChannelIds.has(channel.id));
  const status = chatStatusTone({
    blocked: activity.waiting_member_ids.length > 0,
    streaming: activity.member_ids.length > 0,
    completed,
    unread: !!channel.unread,
  });
  const showSpinner = status === 'running';
  const statusSlot = (
    <span className={styles['status-slot']}>
      {showSpinner ? (
        <AsciiSpinner className={styles.spinner} />
      ) : (
        <Hash className={styles['provider-icon']} />
      )}
      {status && !showSpinner && (
        <ChatStatusDot
          tone={status}
          className={styles['status-corner']}
          ringClassName={styles['status-ring']}
        />
      )}
    </span>
  );
  return (
    <RecentRow
      id={channel.id}
      leading={statusSlot}
      title={channel.name}
      meta={meta}
      isRemote={isRemote}
      status={status}
      updatedAt={channel.updated_at}
      onSelect={onSelect}
    />
  );
}

export function RecentChats({
  entries,
  workspaceBadgeById,
  onChatSelect,
  onChannelSelect,
}: RecentChatsProps) {
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
        {entries.slice(0, MAX_RECENT_ENTRIES).map((entry) => {
          if (entry.kind === 'channel') {
            const { channel, machineId } = entry;
            const workspaceName = workspaceBadgeById.get(channel.workspace_id)?.name;
            const memberNames = channel.members.map((member) => member.display_name).join(', ');
            return (
              <RecentChannelRow
                key={`channel:${channel.id}`}
                channel={channel}
                meta={[workspaceName, memberNames].filter(Boolean).join(' · ')}
                isRemote={machineId !== LOCAL_MACHINE_ID}
                onSelect={onChannelSelect}
              />
            );
          }
          const { chat } = entry;
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
              key={`chat:${chat.id}`}
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
