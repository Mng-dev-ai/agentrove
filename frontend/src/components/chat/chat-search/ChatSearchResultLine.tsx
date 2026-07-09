import { memo } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { ChatSearchMatch } from '@/types/chat.types';

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
    <Button
      variant="unstyled"
      onClick={onClick}
      className="flex w-full items-start gap-1.5 rounded px-1.5 py-0.5 text-left text-2xs leading-5 text-text-secondary hover:bg-surface-hover dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover"
    >
      <span className="min-w-[1.75rem] shrink-0 text-right uppercase tabular-nums text-text-quaternary dark:text-text-dark-quaternary">
        {role === 'user' ? 'you' : 'ai'}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {snippet_before}
        <mark className="rounded-sm bg-surface-active px-0.5 text-text-primary dark:bg-surface-dark-hover dark:text-text-dark-primary">
          {snippet_match}
        </mark>
        {snippet_after}
      </span>
    </Button>
  );
});
