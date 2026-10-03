import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Hash, Send, Square } from 'lucide-react';
import toast from 'react-hot-toast';
import { MarkDown } from '@/components/ui/markdown/MarkDown';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { UserAvatarCircle } from '@/components/chat/message-bubble/MessageAvatars';
import { useChannelLive } from '@/hooks/useChannelLive';
import { useCurrentUserQuery } from '@/hooks/queries/useAuthQueries';
import {
  usePostChannelMessageMutation,
  useStopChannelMutation,
} from '@/hooks/queries/useChannelQueries';
import { EMPTY_MESSAGES, useChannelStore } from '@/store/channelStore';
import { useAuthStore } from '@/store/authStore';
import { getAgentKindForModelId } from '@/types/chat.types';
import type { Channel, ChannelMember, ChannelMessage } from '@/types/channel.types';
import styles from './ChannelView.module.scss';

const STICK_TO_BOTTOM_PX = 80;

function typingLabel(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing…`;
  const head = names.slice(0, -1).join(', ');
  return `${head} and ${names[names.length - 1]} are typing…`;
}

interface ChannelMessageItemProps {
  message: ChannelMessage;
  member: ChannelMember | undefined;
  userName: string;
}

function ChannelMessageItem({ message, member, userName }: ChannelMessageItemProps) {
  const isUser = message.author_type === 'user';
  const isCancelled = message.status === 'cancelled';
  const isStreaming = message.status === 'streaming';

  return (
    <div className={clsx(styles.message, isCancelled && styles['message--cancelled'])}>
      <div className={styles.avatar}>
        {isUser || !member ? (
          <UserAvatarCircle displayName={isUser ? userName : '?'} />
        ) : (
          <ProviderIcon
            agentKind={getAgentKindForModelId(member.model_id)}
            className={styles['provider-icon']}
          />
        )}
      </div>
      <div className={styles['message-body']}>
        <div className={styles['message-meta']}>
          <span className={styles.author}>
            {isUser ? 'You' : (member?.display_name ?? 'agent')}
          </span>
          {isCancelled && <span className={styles.interrupted}>interrupted</span>}
        </div>
        <MarkDown content={message.content} streaming={isStreaming} />
      </div>
    </div>
  );
}

export function ChannelView({ channel }: { channel: Channel }) {
  useChannelLive(channel.id);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: currentUser } = useCurrentUserQuery({ enabled: isAuthenticated });
  const userName = currentUser?.username || currentUser?.email || '';

  const messagesById = useChannelStore(
    (state) => state.messagesByChannel[channel.id] ?? EMPTY_MESSAGES,
  );

  const messages = useMemo(
    () => Object.values(messagesById).sort((a, b) => a.seq - b.seq),
    [messagesById],
  );
  const membersById = useMemo(
    () => new Map(channel.members.map((member) => [member.id, member])),
    [channel.members],
  );
  const speakers = messages.filter((m) => m.status === 'streaming');
  const typingNames = [
    ...new Set(speakers.flatMap((m) => membersById.get(m.member_id ?? '')?.display_name ?? [])),
  ];
  const isBusy = speakers.length > 0;

  const [draft, setDraft] = useState('');
  const postMessage = usePostChannelMessageMutation();
  const stopChannel = useStopChannelMutation();

  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [messages.length, lastMessage?.content, typingNames.length]);

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    stickToBottomRef.current =
      list.scrollHeight - list.scrollTop - list.clientHeight < STICK_TO_BOTTOM_PX;
  };

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || postMessage.isPending) return;
    stickToBottomRef.current = true;
    try {
      await postMessage.mutateAsync({ channelId: channel.id, content });
      setDraft('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    }
  };

  const handleStop = () => {
    stopChannel.mutate(channel.id, {
      onError: (error) => toast.error(error.message || 'Failed to stop'),
    });
  };

  return (
    <div className={styles.channel}>
      <header className={styles.header}>
        <Hash className={styles['header-icon']} />
        <h1 className={styles['channel-name']}>{channel.name}</h1>
        <div className={styles.chips}>
          {channel.members.map((member) => (
            <span key={member.id} className={styles.chip}>
              <ProviderIcon
                agentKind={getAgentKindForModelId(member.model_id)}
                className={styles['chip-icon']}
              />
              {member.display_name}
            </span>
          ))}
        </div>
      </header>

      <div ref={listRef} onScroll={handleScroll} className={styles.list}>
        {messages.length === 0 && <p className={styles.empty}>No messages yet</p>}
        {messages.map((message) => (
          <ChannelMessageItem
            key={message.id}
            message={message}
            member={message.member_id ? membersById.get(message.member_id) : undefined}
            userName={userName}
          />
        ))}
      </div>

      <div className={styles.typing} aria-live="polite">
        {typingNames.length > 0 && typingLabel(typingNames)}
      </div>

      <div className={styles.composer}>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={`Message #${channel.name}`}
          rows={2}
          className={styles.textarea}
        />
        {isBusy && (
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleStop}
            disabled={stopChannel.isPending}
            aria-label="Stop"
          >
            <Square className={styles['action-icon']} />
            Stop
          </Button>
        )}
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={() => void handleSend()}
          disabled={!draft.trim() || postMessage.isPending}
          aria-label="Send"
        >
          <Send className={styles['action-icon']} />
        </Button>
      </div>
    </div>
  );
}
