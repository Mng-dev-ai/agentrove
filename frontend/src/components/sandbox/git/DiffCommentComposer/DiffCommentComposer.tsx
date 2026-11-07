import { useState } from 'react';
import { CornerDownLeft, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Textarea } from '@/components/ui/primitives/Textarea/Textarea';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import styles from './DiffCommentComposer.module.scss';

interface DiffCommentComposerProps {
  lineLabel: string;
  initialValue?: string;
  onSubmit: (comment: string) => void;
  onCancel: () => void;
}

// Pierre line annotation under selected lines; frosted-card look matches InlineChatWidget.
export function DiffCommentComposer({
  lineLabel,
  initialValue = '',
  onSubmit,
  onCancel,
}: DiffCommentComposerProps) {
  const [comment, setComment] = useState(initialValue);
  const trimmed = comment.trim();

  return (
    <div
      className={styles.composer}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <div className={styles['composer-header']}>
        <span className={styles['composer-title']}>Comment on {lineLabel}</span>
        <Button
          type="button"
          variant="unstyled"
          onClick={onCancel}
          aria-label="Discard comment"
          className={styles['composer-close']}
        >
          <X className={styles['icon-xs']} />
        </Button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
        className={styles['composer-form']}
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
          className={styles['composer-textarea']}
        />
        <FloatingTooltip content="Save comment (Enter)" className={styles['submit-slot']}>
          <Button
            type="submit"
            variant="unstyled"
            disabled={!trimmed}
            aria-label="Save comment"
            className={styles['composer-submit']}
          >
            <CornerDownLeft className={styles['icon-sm']} />
          </Button>
        </FloatingTooltip>
      </form>
    </div>
  );
}
