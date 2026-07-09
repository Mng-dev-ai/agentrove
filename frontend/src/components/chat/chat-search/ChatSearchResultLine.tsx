import { memo } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { ChatSearchMatch } from '@/types/chat.types';
import styles from './ChatSearchResultLine.module.scss';

export interface ChatSearchResultLineProps {
  match: ChatSearchMatch;
  onClick: () => void;
}

export const ChatSearchResultLine = memo(function ChatSearchResultLine({
  match,
  onClick,
}: ChatSearchResultLineProps) {
  const { snippet_before, snippet_match, snippet_after, role } = match;

  return (
    <Button variant="unstyled" onClick={onClick} className={styles['chat-search-result-line']}>
      <span className={styles.role}>{role === 'user' ? 'you' : 'ai'}</span>
      <span className={styles.snippet}>
        {snippet_before}
        <mark className={styles.highlight}>{snippet_match}</mark>
        {snippet_after}
      </span>
    </Button>
  );
});
