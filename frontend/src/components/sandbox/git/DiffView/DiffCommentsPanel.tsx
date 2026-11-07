import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FileIcon } from '@/components/ui/shared/FileIcon/FileIcon';
import type { DiffComment } from '@/store/diffCommentsStore';
import { formatLineLabel } from '@/utils/diffSelection';
import styles from './DiffToolbar.module.scss';

interface DiffCommentsPanelProps {
  commentsByFile: Map<string, DiffComment[]>;
  onJump: (comment: DiffComment) => void;
  onEdit: (comment: DiffComment) => void;
  onDelete: (id: string) => void;
  onSend: () => void;
}

export function DiffCommentsPanel({
  commentsByFile,
  onJump,
  onEdit,
  onDelete,
  onSend,
}: DiffCommentsPanelProps) {
  return (
    <>
      <div className={styles['comments-header']}>
        <span className={styles['comments-title']}>Pending comments</span>
        <Button size="sm" onClick={onSend}>
          Send to agent
        </Button>
      </div>
      <div className={styles['comments-list']}>
        {[...commentsByFile].map(([path, comments]) => (
          <div key={path}>
            <div className={styles['comments-file']}>
              <FileIcon name={path} className={styles['menu-item-icon']} />
              <span className={styles['comments-file-name']}>{path}</span>
            </div>
            {comments.map((comment) => (
              <div key={comment.id} className={styles['comment-item']}>
                <Button
                  variant="unstyled"
                  onClick={() => onJump(comment)}
                  className={styles['comment-jump']}
                >
                  <span className={styles['comment-line']}>{formatLineLabel(comment)}</span>
                  <span className={styles['comment-text']}>{comment.body}</span>
                </Button>
                <Button
                  variant="unstyled"
                  onClick={() => onEdit(comment)}
                  aria-label="Edit comment"
                  className={styles['icon-button']}
                >
                  <Pencil className={styles['menu-item-icon']} />
                </Button>
                <Button
                  variant="unstyled"
                  onClick={() => onDelete(comment.id)}
                  aria-label="Delete comment"
                  className={styles['icon-button']}
                >
                  <Trash2 className={styles['menu-item-icon']} />
                </Button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
