import { memo, useMemo, useState } from 'react';
import { MarkDown } from '@/components/ui/markdown/MarkDown';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import {
  ConversationColumn,
  ConversationLayout,
  ConversationScroller,
} from '@/components/chat/chat-window/ConversationLayout';
import { ChatSkeleton } from '@/components/chat/chat-window/ChatSkeleton';
import { InlinePermission } from '@/components/chat/chat-window/ChatInlinePermission';
import { StatusIndicator } from '@/components/chat/chat-window/StatusTypewriter';
import { useChatScroll } from '@/components/chat/chat-window/useChatScroll';
import { MessageRow, MessageText, UserBubble } from '@/components/chat/message-bubble/Message';
import { MessageAttachments } from '@/components/chat/message-bubble/MessageAttachments';
import { MessageRenderer } from '@/components/chat/message-bubble/MessageRenderer';
import { ToolLoadingFallback } from '@/components/chat/message-bubble/SegmentView';
import { WorkedRollup } from '@/components/chat/message-bubble/WorkedRollup';
import { useChannelMessageActivityQuery } from '@/hooks/queries/useChannelQueries';
import { useChannelLive } from '@/hooks/useChannelLive';
import { useSmoothText } from '@/hooks/useSmoothText';
import { permissionService } from '@/services/permissionService';
import {
  EMPTY_MESSAGES,
  EMPTY_PERMISSIONS,
  useChannelActivity,
  useChannelStore,
} from '@/store/channelStore';
import { getAgentKindForModelId, type AgentKind } from '@/types/chat.types';
import { formatFullTimestamp, formatRelativeTime } from '@/utils/date';
import { executePermissionResponse } from '@/utils/permissionResponse';
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelPermissionRequest,
} from '@/types/channel.types';
import { ChannelComposer } from './ChannelComposer';
import styles from './ChannelView.module.scss';

const NO_OLDER_PAGES = () => {};
const ACTIVITY_EVENT_TYPES = new Set([
  'assistant_thinking',
  'tool_started',
  'tool_completed',
  'tool_failed',
  'plan',
]);

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

interface ChannelMessageActivityProps {
  channelId: string;
  messageId: string;
  agentKind: AgentKind;
}

function ChannelMessageActivity({ channelId, messageId, agentKind }: ChannelMessageActivityProps) {
  const { data, isPending, isError } = useChannelMessageActivityQuery(channelId, messageId);
  const events = useMemo(
    () => data?.content_render.events.filter((event) => ACTIVITY_EVENT_TYPES.has(event.type)),
    [data],
  );

  if (isError) return <p className={styles['activity-unavailable']}>Activity unavailable</p>;
  if (isPending || !events) return <ToolLoadingFallback />;
  return <MessageRenderer events={events} chatId={data.chat_id} agentKind={agentKind} />;
}

interface AgentChannelMessageProps {
  message: ChannelMessage;
  member: ChannelMember | undefined;
}

function AgentChannelMessage({ message, member }: AgentChannelMessageProps) {
  const isStreaming = message.status === 'streaming';
  const isInterrupted = message.status === 'cancelled';
  const agentKind = getAgentKindForModelId(member?.model_id);
  const [content, isRevealing] = useSmoothText(message.content, isStreaming, true);
  const text = (
    <MessageText>
      <MarkDown content={content} streaming={isRevealing} />
    </MessageText>
  );

  return (
    <MessageRow>
      <div className={styles.author}>
        <ProviderIcon agentKind={agentKind} className={styles['author-icon']} />
        <span className={styles['author-name']}>{member?.display_name ?? 'agent'}</span>
        <Tooltip content={formatFullTimestamp(message.created_at)} position="bottom">
          <span className={styles['author-meta']}>{formatRelativeTime(message.created_at)}</span>
        </Tooltip>
        {isInterrupted && (
          <>
            <span className={styles['author-meta']}>·</span>
            <span className={styles.interrupted}>Interrupted</span>
          </>
        )}
      </div>
      {!isStreaming && message.tool_call_count > 0 && (
        <WorkedRollup durationMs={message.duration_ms}>
          <ChannelMessageActivity
            channelId={message.channel_id}
            messageId={message.id}
            agentKind={agentKind}
          />
        </WorkedRollup>
      )}
      {isInterrupted ? <div className={styles['interrupted-text']}>{text}</div> : text}
    </MessageRow>
  );
}

function memberStatus(members: ChannelMember[], singular: string, plural: string): string {
  return `${joinNames(members.map((member) => member.display_name))} ${members.length === 1 ? singular : plural}`;
}

interface ChannelTypingRowProps {
  thinking: ChannelMember[];
  typing: ChannelMember[];
  waiting: ChannelMember[];
  retrying: ChannelMember[];
}

const ChannelTypingRow = memo(function ChannelTypingRow({
  thinking,
  typing,
  waiting,
  retrying,
}: ChannelTypingRowProps) {
  const text = [
    typing.length > 0 && memberStatus(typing, 'is typing', 'are typing'),
    thinking.length > 0 && memberStatus(thinking, 'is thinking…', 'are thinking…'),
    waiting.length > 0 &&
      memberStatus(waiting, 'is waiting for approval', 'are waiting for approval'),
    retrying.length > 0 &&
      memberStatus(retrying, 'hit an error, retrying soon', 'hit errors, retrying soon'),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div aria-live="polite">
      <StatusIndicator
        leading={
          <span className={styles['typing-icons']}>
            {[...typing, ...thinking, ...waiting, ...retrying].map((member) => (
              <ProviderIcon
                key={member.id}
                agentKind={getAgentKindForModelId(member.model_id)}
                className={styles['author-icon']}
              />
            ))}
          </span>
        }
        text={text}
        caretBlinking={thinking.length > 0 || typing.length > 0}
      />
    </div>
  );
});

interface ChannelApprovalProps {
  channelId: string;
  permission: ChannelPermissionRequest;
  member: ChannelMember | undefined;
}

function ChannelApproval({ channelId, permission, member }: ChannelApprovalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { chat_id: chatId, member_id: memberId, request } = permission;

  const respond = (optionId: string) =>
    void executePermissionResponse(
      () => permissionService.respondToPermission(chatId, request.request_id, optionId),
      {
        setIsLoading,
        setError,
        errorMessage: 'Failed to respond to approval',
        clearRequest: () =>
          useChannelStore.getState().dropPermission(channelId, memberId, request.request_id),
      },
    );

  return (
    <InlinePermission
      request={request}
      onApprove={respond}
      onReject={respond}
      isLoading={isLoading}
      error={error}
      header={
        <div className={styles.author}>
          <ProviderIcon
            agentKind={getAgentKindForModelId(member?.model_id)}
            className={styles['author-icon']}
          />
          <span className={styles['author-name']}>{member?.display_name ?? 'agent'}</span>
          <span className={styles['author-meta']}>needs approval</span>
        </div>
      }
    />
  );
}

function ChannelEmptyState({ channel }: { channel: Channel }) {
  return (
    <div className={styles.empty}>
      <div className={styles['empty-icons']}>
        {channel.members.map((member) => (
          <span key={member.id} className={styles['empty-icon-circle']}>
            <ProviderIcon
              agentKind={getAgentKindForModelId(member.model_id)}
              className={styles['empty-icon']}
            />
          </span>
        ))}
      </div>
      <h2 className={styles['empty-title']}>#{channel.name}</h2>
      <p className={styles['empty-subtitle']}>
        {`${joinNames(channel.members.map((member) => member.display_name))} will reply when they have something to add.`}
      </p>
    </div>
  );
}

export function ChannelView({ channel }: { channel: Channel }) {
  useChannelLive(channel.id);

  const messagesById = useChannelStore(
    (state) => state.channels[channel.id]?.messages ?? EMPTY_MESSAGES,
  );
  const isSynced = useChannelStore((state) => state.channels[channel.id]?.synced ?? false);
  const permissions = useChannelStore(
    (state) => state.channels[channel.id]?.permissions ?? EMPTY_PERMISSIONS,
  );
  const activity = useChannelActivity(channel);

  const messages = useMemo(
    () =>
      Object.values(messagesById)
        .filter((message) => message.status !== 'deleted')
        .sort((a, b) => a.seq - b.seq),
    [messagesById],
  );
  const visibleMessages = useMemo(
    () => messages.filter((m) => m.status !== 'streaming' || m.content),
    [messages],
  );
  const membersById = useMemo(
    () => new Map(channel.members.map((member) => [member.id, member])),
    [channel.members],
  );
  const { thinkingMembers, typingMembers, waitingMembers, retryingMembers } = useMemo(() => {
    const waitingIds = new Set(permissions.map((p) => p.member_id));
    const typingIds = new Set(
      messages.flatMap((m) => (m.status === 'streaming' && m.member_id ? [m.member_id] : [])),
    );
    const activeIds = new Set(activity.member_ids);
    const retryingIds = new Set(activity.retrying_member_ids);
    return {
      thinkingMembers: channel.members.filter(
        (member) =>
          activeIds.has(member.id) && !typingIds.has(member.id) && !waitingIds.has(member.id),
      ),
      typingMembers: channel.members.filter(
        (member) => typingIds.has(member.id) && !waitingIds.has(member.id),
      ),
      waitingMembers: channel.members.filter((member) => waitingIds.has(member.id)),
      retryingMembers: channel.members.filter((member) => retryingIds.has(member.id)),
    };
  }, [messages, permissions, activity, channel.members]);
  const isBusy =
    thinkingMembers.length > 0 ||
    typingMembers.length > 0 ||
    waitingMembers.length > 0 ||
    retryingMembers.length > 0;

  const { showScrollButton, containerRefCallback, scrollToBottom } = useChatScroll({
    chatId: channel.id,
    messages: visibleMessages,
    pendingUserMessageId: null,
    latestUserMessageId: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: NO_OLDER_PAGES,
  });

  return (
    <ConversationLayout
      showScrollButton={showScrollButton}
      onScrollToBottom={scrollToBottom}
      composer={<ChannelComposer channel={channel} isBusy={isBusy} onSend={scrollToBottom} />}
    >
      {messages.length === 0 ? (
        isSynced ? (
          <ChannelEmptyState channel={channel} />
        ) : (
          <ChatSkeleton messageCount={3} />
        )
      ) : (
        <ConversationScroller ref={containerRefCallback}>
          {visibleMessages.map((message) => (
            <ConversationColumn key={message.id}>
              {message.author_type === 'user' ? (
                <MessageRow>
                  <UserBubble>
                    <MessageAttachments
                      attachments={message.attachments}
                      className={styles.attachments}
                    />
                    <MarkDown content={message.content} highlightMentions />
                  </UserBubble>
                </MessageRow>
              ) : (
                <AgentChannelMessage
                  message={message}
                  member={message.member_id ? membersById.get(message.member_id) : undefined}
                />
              )}
            </ConversationColumn>
          ))}
          {permissions.map((permission) => (
            <ConversationColumn key={`${permission.member_id}:${permission.request.request_id}`}>
              <ChannelApproval
                channelId={channel.id}
                permission={permission}
                member={membersById.get(permission.member_id)}
              />
            </ConversationColumn>
          ))}
          {isBusy && (
            <ConversationColumn>
              <ChannelTypingRow
                thinking={thinkingMembers}
                typing={typingMembers}
                waiting={waitingMembers}
                retrying={retryingMembers}
              />
            </ConversationColumn>
          )}
        </ConversationScroller>
      )}
    </ConversationLayout>
  );
}
