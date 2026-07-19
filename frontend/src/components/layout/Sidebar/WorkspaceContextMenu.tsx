import { type Ref } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './WorkspaceContextMenu.module.scss';

interface WorkspaceContextMenuProps {
  ref?: Ref<HTMLDivElement>;
  position: { top: number; left: number };
  onNewThread: (e: React.MouseEvent) => void;
  onRename: () => void;
  onDelete: () => void;
}

// Flat list has no group headers — badge menu holds new thread / rename / delete.
export function WorkspaceContextMenu({
  ref,
  position,
  onNewThread,
  onRename,
  onDelete,
}: WorkspaceContextMenuProps) {
  return (
    <div
      ref={ref}
      className={styles['workspace-menu']}
      style={{ top: position.top, left: position.left }}
    >
      <Button
        variant="unstyled"
        type="button"
        onClick={onNewThread}
        className={styles['menu-item']}
      >
        New thread
      </Button>
      <Button variant="unstyled" type="button" onClick={onRename} className={styles['menu-item']}>
        Rename
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={onDelete}
        className={styles['menu-item-danger']}
      >
        Delete
      </Button>
    </div>
  );
}
