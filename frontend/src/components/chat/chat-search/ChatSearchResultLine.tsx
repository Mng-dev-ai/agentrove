import { memo, type Ref } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { ChatSearchMatch } from '@/types/chat.types';
import styles from './ChatSearchResultLine.module.scss';

export interface ChatSearchResultLineProps {
  id: string;
  isActive: boolean;
  itemRef: Ref<HTMLButtonElement> | undefined;
  match: Pick<ChatSearchMatch, 'snippet_before' | 'snippet_match' | 'snippet_after'>;
  label: string;
  onClick: () => void;
}

export const ChatSearchResultLine = memo(function ChatSearchResultLine({
  id,
  isActive,
  itemRef,
  match,
  label,
  onClick,
}: ChatSearchResultLineProps) {
  const { snippet_before, snippet_match, snippet_after } = match;

  return (
    <Button
      ref={itemRef}
      id={id}
      role="option"
      aria-selected={isActive}
      variant="unstyled"
      onClick={onClick}
      className={clsx(
        styles['chat-search-result-line'],
        isActive && styles['chat-search-result-line--active'],
      )}
    >
      <span className={styles.role}>{label}</span>
      <span className={styles.snippet}>
        {snippet_before}
        <mark className={styles.highlight}>{snippet_match}</mark>
        {snippet_after}
      </span>
    </Button>
  );
});
