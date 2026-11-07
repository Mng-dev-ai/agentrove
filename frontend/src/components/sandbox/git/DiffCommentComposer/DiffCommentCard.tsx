import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './DiffCommentComposer.module.scss';

interface DiffCommentActionsProps {
  onEdit: () => void;
  onDelete: () => void;
}

export function DiffCommentActions({ onEdit, onDelete }: DiffCommentActionsProps) {
  return (
    <div className={styles['comment-actions']}>
      <Button
        type="button"
        variant="unstyled"
        onClick={onEdit}
        aria-label="Edit comment"
        className={styles['comment-action']}
      >
        <Pencil className={styles['icon-xs']} />
      </Button>
      <Button
        type="button"
        variant="unstyled"
        onClick={onDelete}
        aria-label="Delete comment"
        className={styles['comment-action']}
      >
        <Trash2 className={styles['icon-xs']} />
      </Button>
    </div>
  );
}

export function DiffCommentOutdatedTag() {
  return <span className={styles['outdated-tag']}>Outdated</span>;
}

interface DiffCommentCardProps extends DiffCommentActionsProps {
  lineLabel: string;
  body: string;
  // Outdated comments aren't line-anchored, so the snippet carries the context.
  outdatedSnippet: string | null;
}

// Saved pending comment, rendered inline in the same card as the composer.
export function DiffCommentCard({
  lineLabel,
  body,
  outdatedSnippet,
  onEdit,
  onDelete,
}: DiffCommentCardProps) {
  return (
    <div className={styles.composer}>
      <div className={styles['composer-header']}>
        <span className={styles['composer-title']}>Comment on {lineLabel}</span>
        {outdatedSnippet !== null && <DiffCommentOutdatedTag />}
        <DiffCommentActions onEdit={onEdit} onDelete={onDelete} />
      </div>
      {outdatedSnippet && <pre className={styles['comment-snippet']}>{outdatedSnippet}</pre>}
      <p className={styles['comment-body']}>{body}</p>
    </div>
  );
}
