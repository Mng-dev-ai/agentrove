import { memo, useState } from 'react';
import clsx from 'clsx';
import { ChevronRight, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { ChatSearchResult } from '@/types/chat.types';
import { ChatSearchResultLine } from './ChatSearchResultLine';
import styles from './ChatSearchResultGroup.module.scss';

export interface ChatSearchResultGroupProps {
  result: ChatSearchResult;
  onOpen: (chatId: string) => void;
}

export const ChatSearchResultGroup = memo(function ChatSearchResultGroup({
  result,
  onOpen,
}: ChatSearchResultGroupProps) {
  const [expanded, setExpanded] = useState(true);
  const hasMore = result.match_count > result.matches.length;

  return (
    <div className={styles['chat-search-result-group']}>
      <Button
        variant="unstyled"
        onClick={() => setExpanded((prev) => !prev)}
        className={styles['header-button']}
      >
        <ChevronRight className={clsx(styles.chevron, expanded && styles['chevron--expanded'])} />
        <MessageSquare className={styles['chat-icon']} />
        <span className={styles['chat-title']}>{result.chat_title}</span>
        <span className={styles['match-count']}>{result.match_count}</span>
      </Button>

      {expanded && (
        <div className={styles.lines}>
          {result.matches.map((match) => (
            <ChatSearchResultLine
              key={match.message_id}
              match={match}
              onClick={() => onOpen(result.chat_id)}
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
