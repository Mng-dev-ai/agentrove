import { memo } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { ChatSearchMatch } from '@/types/chat.types';
import styles from './ChatSearchResultLine.module.scss';

export interface ChatSearchResultLineProps {
  match: Pick<ChatSearchMatch, 'snippet_before' | 'snippet_match' | 'snippet_after'>;
  label: string;
  onClick: () => void;
}

export const ChatSearchResultLine = memo(function ChatSearchResultLine({
  match,
  label,
  onClick,
}: ChatSearchResultLineProps) {
  const { snippet_before, snippet_match, snippet_after } = match;

  return (
    <Button variant="unstyled" onClick={onClick} className={styles['chat-search-result-line']}>
      <span className={styles.role}>{label}</span>
      <span className={styles.snippet}>
        {snippet_before}
        <mark className={styles.highlight}>{snippet_match}</mark>
        {snippet_after}
      </span>
    </Button>
  );
});
