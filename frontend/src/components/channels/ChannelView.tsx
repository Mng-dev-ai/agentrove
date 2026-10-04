import { memo, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { MarkDown } from '@/components/ui/markdown/MarkDown';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { Textarea } from '@/components/chat/message-input/Textarea';
import { SendButton, type SendButtonStatus } from '@/components/chat/message-input/SendButton';
import { ComposerField } from '@/components/chat/message-input/ComposerField';
import {
  ConversationColumn,
  ConversationLayout,
  ConversationScroller,
} from '@/components/chat/chat-window/ConversationLayout';
import { ChatSkeleton } from '@/components/chat/chat-window/ChatSkeleton';
import { StatusIndicator } from '@/components/chat/chat-window/StatusTypewriter';
import { useChatScroll } from '@/components/chat/chat-window/useChatScroll';
import { MessageRow, MessageText, UserBubble } from '@/components/chat/message-bubble/Message';
import { useChannelLive } from '@/hooks/useChannelLive';
import { useSmoothText } from '@/hooks/useSmoothText';
import {
  usePostChannelMessageMutation,
  useStopChannelMutation,
} from '@/hooks/queries/useChannelQueries';
import { EMPTY_MESSAGES, useChannelStore } from '@/store/channelStore';
import { getAgentKindForModelId } from '@/types/chat.types';
import { formatFullTimestamp, formatRelativeTime } from '@/utils/date';
import type { Channel, ChannelMember, ChannelMessage } from '@/types/channel.types';
import styles from './ChannelView.module.scss';

const NO_OLDER_PAGES = () => {};

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

interface AgentChannelMessageProps {
  message: ChannelMessage;
  member: ChannelMember | undefined;
}

function AgentChannelMessage({ message, member }: AgentChannelMessageProps) {
  const isStreaming = message.status === 'streaming';
  const isInterrupted = message.status === 'cancelled';
  const content = useSmoothText(message.content, isStreaming);
  const text = (
    <MessageText>
      <MarkDown content={content} streaming={isStreaming} />
    </MessageText>
  );

  return (
    <MessageRow>
      <div className={styles.author}>
        <ProviderIcon
          agentKind={getAgentKindForModelId(member?.model_id)}
          className={styles['author-icon']}
        />
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
      {isInterrupted ? <div className={styles['interrupted-text']}>{text}</div> : text}
    </MessageRow>
  );
}

const ChannelTypingRow = memo(function ChannelTypingRow({ members }: { members: ChannelMember[] }) {
  const names = members.map((member) => member.display_name);
  return (
    <div aria-live="polite">
      <StatusIndicator
        leading={
          <span className={styles['typing-icons']}>
            {members.map((member) => (
              <ProviderIcon
                key={member.id}
                agentKind={getAgentKindForModelId(member.model_id)}
                className={styles['author-icon']}
              />
            ))}
          </span>
        }
        text={`${joinNames(names)} ${names.length === 1 ? 'is' : 'are'} typing`}
        caretBlinking={true}
      />
    </div>
  );
});

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
  const typingMembers = useMemo(() => {
    const ids = new Set(
      messages.flatMap((m) => (m.status === 'streaming' && m.member_id ? [m.member_id] : [])),
    );
    return channel.members.filter((member) => ids.has(member.id));
  }, [messages, channel.members]);
  const isBusy = typingMembers.length > 0;

  const { showScrollButton, containerRefCallback, scrollToBottom } = useChatScroll({
    chatId: channel.id,
    messages: visibleMessages,
    pendingUserMessageId: null,
    latestUserMessageId: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: NO_OLDER_PAGES,
  });

  const [draft, setDraft] = useState('');
  const postMessage = usePostChannelMessageMutation();
  const stopChannel = useStopChannelMutation();

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || postMessage.isPending) return;
    setDraft('');
    scrollToBottom();
    try {
      await postMessage.mutateAsync({ channelId: channel.id, content });
    } catch (error) {
      setDraft((current) => (current ? `${content}\n${current}` : content));
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    }
  };

  const handleStop = () => {
    stopChannel.mutate(channel.id, {
      onError: (error) => toast.error(error.message || 'Failed to stop'),
    });
  };

  const hasDraft = draft.trim().length > 0;
  const sendStatus: SendButtonStatus = hasDraft
    ? 'ready'
    : isBusy
      ? 'streaming'
      : postMessage.isPending
        ? 'loading'
        : 'idle';

  return (
    <ConversationLayout
      showScrollButton={showScrollButton}
      onScrollToBottom={scrollToBottom}
      composer={
        <ComposerField
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          textarea={
            <Textarea
              message={draft}
              setMessage={setDraft}
              placeholder={`Message #${channel.name}`}
              isLoading={postMessage.isPending}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
          }
          actions={
            <SendButton
              status={sendStatus}
              disabled={
                sendStatus === 'idle' ||
                sendStatus === 'loading' ||
                (sendStatus === 'streaming' && stopChannel.isPending)
              }
              onClick={hasDraft ? () => void handleSend() : handleStop}
            />
          }
        />
      }
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
          {isBusy && (
            <ConversationColumn>
              <ChannelTypingRow members={typingMembers} />
            </ConversationColumn>
          )}
        </ConversationScroller>
      )}
    </ConversationLayout>
  );
}
