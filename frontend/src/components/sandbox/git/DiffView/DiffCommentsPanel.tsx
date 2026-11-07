import { Send } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FileIcon } from '@/components/ui/shared/FileIcon/FileIcon';
import { useDiffCommentsStore, type DiffComment } from '@/store/diffCommentsStore';
import { formatLineLabel } from '@/utils/diffSelection';
import {
  DiffCommentActions,
  DiffCommentOutdatedTag,
} from '@/components/sandbox/git/DiffCommentComposer/DiffCommentCard';
import styles from './DiffCommentsPanel.module.scss';

interface DiffCommentsPanelProps {
  commentsByFile: Map<string, DiffComment[]>;
  reviewKeyByFile: Map<string, string>;
  onJump: (comment: DiffComment) => void;
  onDelete: (id: string) => void;
  onSend: () => void;
  onClose: () => void;
}

export function DiffCommentsPanel({
  commentsByFile,
  reviewKeyByFile,
  onJump,
  onDelete,
  onSend,
  onClose,
}: DiffCommentsPanelProps) {
  return (
    <>
      <div className={styles.header}>
        <span className={styles.title}>Pending comments</span>
        <Button
          variant="unstyled"
          onClick={() => {
            onSend();
            onClose();
          }}
          className={styles.send}
        >
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
                <Button
                  variant="unstyled"
                  onClick={() => {
                    onJump(comment);
                    onClose();
                  }}
                  className={styles.jump}
                >
                  <span className={styles.line}>
                    {formatLineLabel(comment)}
                    {comment.contentKey !== reviewKeyByFile.get(path) && <DiffCommentOutdatedTag />}
                  </span>
                  <span className={styles.text}>{comment.body}</span>
                </Button>
                <DiffCommentActions
                  onEdit={() => {
                    useDiffCommentsStore.getState().setEditingCommentId(comment.id);
                    onJump(comment);
                    onClose();
                  }}
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
