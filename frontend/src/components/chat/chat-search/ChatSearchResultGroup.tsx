import { memo, useState } from 'react';
import clsx from 'clsx';
import { ChevronRight, Hash, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { ChannelSearchResult, ChatSearchResult } from '@/types/chat.types';
import { ChatSearchResultLine } from './ChatSearchResultLine';
import styles from './ChatSearchResultGroup.module.scss';

export type SearchHit =
  | { kind: 'chat'; result: ChatSearchResult }
  | { kind: 'channel'; result: ChannelSearchResult };

export interface ChatSearchResultGroupProps {
  hit: SearchHit;
  onOpenChat: (chatId: string) => void;
  onOpenChannel: (channelId: string) => void;
}

export const ChatSearchResultGroup = memo(function ChatSearchResultGroup({
  hit,
  onOpenChat,
  onOpenChannel,
}: ChatSearchResultGroupProps) {
  const [expanded, setExpanded] = useState(true);
  const { result } = hit;
  const hasMore = result.match_count > result.matches.length;
  const Icon = hit.kind === 'channel' ? Hash : MessageSquare;
  const title = hit.kind === 'channel' ? hit.result.channel_name : hit.result.chat_title;
  const lines =
    hit.kind === 'channel'
      ? hit.result.matches.map((match) => ({ match, label: match.author ?? 'you' }))
      : hit.result.matches.map((match) => ({
          match,
          label: match.role === 'user' ? 'you' : 'ai',
        }));
  const open = () =>
    hit.kind === 'channel' ? onOpenChannel(hit.result.channel_id) : onOpenChat(hit.result.chat_id);

  return (
    <div className={styles['chat-search-result-group']}>
      <Button
        variant="unstyled"
        onClick={() => setExpanded((prev) => !prev)}
        className={styles['header-button']}
      >
        <ChevronRight className={clsx(styles.chevron, expanded && styles['chevron--expanded'])} />
        <Icon className={styles['chat-icon']} />
        <span className={styles['chat-title']}>{title}</span>
        <span className={styles['match-count']}>{result.match_count}</span>
      </Button>

      {expanded && (
        <div className={styles.lines}>
          {lines.map(({ match, label }) => (
            <ChatSearchResultLine
              key={match.message_id}
              match={match}
              label={label}
              onClick={open}
            />
          ))}
          {hasMore && (
            <span className={styles.more}>+{result.match_count - result.matches.length} more</span>
          )}
        </div>
      )}
    </div>
  );
});
