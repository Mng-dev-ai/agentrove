import { memo, useState } from 'react';
import { ChevronRight, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { ChatSearchResult } from '@/types/chat.types';
import { cn } from '@/utils/cn';
import { ChatSearchResultLine } from './ChatSearchResultLine';

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
    <div className="flex flex-col">
      <Button
        variant="unstyled"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 text-text-quaternary transition-transform duration-150 dark:text-text-dark-quaternary',
            expanded && 'rotate-90',
          )}
        />
        <MessageSquare className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary dark:text-text-dark-primary">
          {result.chat_title}
        </span>
        <span className="ml-auto rounded-full bg-surface-active px-1.5 text-2xs tabular-nums text-text-secondary dark:bg-surface-dark-hover dark:text-text-dark-secondary">
          {result.match_count}
        </span>
      </Button>

      {expanded && (
        <div className="flex flex-col pl-2">
          {result.matches.map((match) => (
            <ChatSearchResultLine
              key={match.message_id}
              match={match}
              onClick={() => onOpen(result.chat_id)}
            />
          ))}
          {hasMore && (
            <span className="px-1.5 py-0.5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              +{result.match_count - result.matches.length} more
            </span>
          )}
        </div>
      )}
    </div>
  );
});
