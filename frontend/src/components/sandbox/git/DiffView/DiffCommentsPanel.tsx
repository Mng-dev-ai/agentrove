import { Send } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FileIcon } from '@/components/ui/shared/FileIcon/FileIcon';
import type { DiffComment } from '@/store/diffCommentsStore';
import { formatLineLabel } from '@/utils/diffSelection';
import { DiffCommentActions } from '@/components/sandbox/git/DiffCommentComposer/DiffCommentCard';
import styles from './DiffCommentsPanel.module.scss';

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
      <div className={styles.header}>
        <span className={styles.title}>Pending comments</span>
        <Button variant="unstyled" onClick={onSend} className={styles.send}>
          <Send className={styles.icon} />
          Send to agent
        </Button>
      </div>
      <div className={styles.list}>
        {[...commentsByFile].map(([path, comments]) => (
          <div key={path}>
            <div className={styles.file}>
              <FileIcon name={path} className={styles.icon} />
              <span className={styles['file-name']}>{path}</span>
            </div>
            {comments.map((comment) => (
              <div key={comment.id} className={styles.item}>
                <Button variant="unstyled" onClick={() => onJump(comment)} className={styles.jump}>
                  <span className={styles.line}>{formatLineLabel(comment)}</span>
                  <span className={styles.text}>{comment.body}</span>
                </Button>
                <DiffCommentActions
                  onEdit={() => onEdit(comment)}
                  onDelete={() => onDelete(comment.id)}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
