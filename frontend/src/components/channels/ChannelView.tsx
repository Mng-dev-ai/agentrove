import { memo, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { MarkDown } from '@/components/ui/markdown/MarkDown';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { Textarea } from '@/components/chat/message-input/Textarea';
import { SendButton, type SendButtonStatus } from '@/components/chat/message-input/SendButton';
import { ScrollButton } from '@/components/chat/chat-window/ScrollButton';
import { ChatSkeleton } from '@/components/chat/chat-window/ChatSkeleton';
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
import chatStyles from '@/components/chat/chat-window/Chat.module.scss';
import typewriterStyles from '@/components/chat/chat-window/StatusTypewriter.module.scss';
import messageStyles from '@/components/chat/message-bubble/Message.module.scss';
import inputStyles from '@/components/chat/message-input/Input.module.scss';
import styles from './ChannelView.module.scss';

const STICK_TO_BOTTOM_PX = 80;

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function UserChannelMessage({ message }: { message: ChannelMessage }) {
  return (
    <div className={messageStyles.message}>
      <div className={messageStyles['user-bubble']}>
        <div className={messageStyles['message-text']}>
          <MarkDown content={message.content} highlightMentions />
        </div>
      </div>
    </div>
  );
}

interface AgentChannelMessageProps {
  message: ChannelMessage;
  member: ChannelMember | undefined;
}

function AgentChannelMessage({ message, member }: AgentChannelMessageProps) {
  const isStreaming = message.status === 'streaming';
  const isInterrupted = message.status === 'cancelled';
  const content = useSmoothText(message.content, isStreaming);

  return (
    <div className={messageStyles.message}>
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
      <div
        className={clsx(
          messageStyles['message-text'],
          isInterrupted && styles['message-text--interrupted'],
        )}
      >
        <MarkDown content={content} streaming={isStreaming} />
      </div>
    </div>
  );
}

const ChannelTypingRow = memo(function ChannelTypingRow({ members }: { members: ChannelMember[] }) {
  const names = members.map((member) => member.display_name);
  return (
    <div className={typewriterStyles['status-typewriter']} aria-live="polite">
      <div className={typewriterStyles['status-row']}>
        <span className={styles['typing-icons']}>
          {members.map((member) => (
            <ProviderIcon
              key={member.id}
              agentKind={getAgentKindForModelId(member.model_id)}
              className={styles['author-icon']}
            />
          ))}
        </span>
        <span className={typewriterStyles['status-verb']}>
          {`${joinNames(names)} ${names.length === 1 ? 'is' : 'are'} typing`}
          <span
            className={clsx(
              typewriterStyles['status-caret'],
              typewriterStyles['status-caret--blinking'],
            )}
          />
        </span>
      </div>
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
  const visibleMessages = messages.filter((m) => m.status !== 'streaming' || m.content);
  const isBusy = typingMembers.length > 0;

  const [draft, setDraft] = useState('');
  const postMessage = usePostChannelMessageMutation();
  const stopChannel = useStopChannelMutation();

  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const versionSum = messages.reduce((sum, message) => sum + message.version, 0);

  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [versionSum, typingMembers.length]);

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_TO_BOTTOM_PX;
    stickToBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
  };

  const scrollToBottom = () => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  };

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || postMessage.isPending) return;
    stickToBottomRef.current = true;
    setDraft('');
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
    <div className={chatStyles.chat}>
      <div className={chatStyles.viewport}>
        {messages.length === 0 ? (
          isSynced ? (
            <ChannelEmptyState channel={channel} />
          ) : (
            <ChatSkeleton messageCount={3} className={chatStyles['skeleton-pad']} />
          )
        ) : (
          <div ref={listRef} onScroll={handleScroll} className={chatStyles.scroller}>
            <div className={clsx(chatStyles.content, styles.content)}>
              {visibleMessages.map((message) => (
                <div key={message.id} className={chatStyles.column}>
                  {message.author_type === 'user' ? (
                    <UserChannelMessage message={message} />
                  ) : (
                    <AgentChannelMessage
                      message={message}
                      member={message.member_id ? membersById.get(message.member_id) : undefined}
                    />
                  )}
                </div>
              ))}
              {isBusy && (
                <div className={chatStyles.column}>
                  <ChannelTypingRow members={typingMembers} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className={chatStyles.composer}>
        {showScrollButton && <ScrollButton onClick={scrollToBottom} />}
        <div className={chatStyles['composer-surface']}>
          <div className={chatStyles['composer-inner']}>
            <div className={chatStyles['input-slot']}>
              <form
                className={inputStyles.input}
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSend();
                }}
              >
                <div className={inputStyles.field}>
                  <div className={inputStyles['textarea-wrap']}>
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
                  </div>
                  <div className={inputStyles.actions}>
                    <SendButton
                      status={sendStatus}
                      disabled={
                        sendStatus === 'idle' ||
                        sendStatus === 'loading' ||
                        (sendStatus === 'streaming' && stopChannel.isPending)
                      }
                      onClick={hasDraft ? () => void handleSend() : handleStop}
                    />
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
