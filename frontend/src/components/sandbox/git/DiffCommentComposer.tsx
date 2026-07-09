import { useState } from 'react';
import { CornerDownLeft, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';

interface DiffCommentComposerProps {
  lineLabel: string;
  onSubmit: (comment: string) => void;
  onCancel: () => void;
}

// Inline comment card rendered as a pierre line annotation under the selected
// diff lines — mirrors the editor InlineChatWidget's frosted-card look.
// `font-sans` resets the diff's monospace context.
export function DiffCommentComposer({ lineLabel, onSubmit, onCancel }: DiffCommentComposerProps) {
  const [comment, setComment] = useState('');
  const trimmed = comment.trim();

  return (
    <div
      className="my-1.5 ml-2 w-[440px] max-w-[calc(100%-1rem)] rounded-xl border border-border bg-surface/95 font-sans shadow-medium backdrop-blur-xl dark:border-border-dark dark:bg-surface-dark/95"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <div className="flex h-9 items-center gap-2 border-b border-border/50 px-3 dark:border-border-dark/50">
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-text-tertiary dark:text-text-dark-tertiary">
          Comment on {lineLabel}
        </span>
        <Button
          type="button"
          variant="unstyled"
          onClick={onCancel}
          aria-label="Discard comment"
          className="text-text-tertiary transition-colors duration-200 hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
        className="flex items-center gap-1 px-2 py-1.5"
      >
        <Textarea
          autoFocus
          variant="unstyled"
          rows={1}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (trimmed) onSubmit(trimmed);
            }
          }}
          placeholder="Leave feedback for the agent…"
          className="max-h-24 flex-1 resize-none bg-transparent px-1 py-1 text-sm text-text-primary placeholder:text-text-quaternary dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary"
        />
        <FloatingTooltip content="Add to chat (Enter)" className="flex">
          <Button
            type="submit"
            variant="unstyled"
            disabled={!trimmed}
            aria-label="Add comment to chat"
            className="rounded-md p-1.5 text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary disabled:opacity-50 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
          >
            <CornerDownLeft className="h-3.5 w-3.5" />
          </Button>
        </FloatingTooltip>
      </form>
    </div>
  );
}
