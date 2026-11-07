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

interface DiffCommentCardProps extends DiffCommentActionsProps {
  lineLabel: string;
  body: string;
}

// Saved pending comment, rendered inline in the same card as the composer.
export function DiffCommentCard({ lineLabel, body, onEdit, onDelete }: DiffCommentCardProps) {
  return (
    <div className={styles.composer}>
      <div className={styles['composer-header']}>
        <span className={styles['composer-title']}>Comment on {lineLabel}</span>
        <DiffCommentActions onEdit={onEdit} onDelete={onDelete} />
      </div>
      <p className={styles['comment-body']}>{body}</p>
    </div>
  );
}
