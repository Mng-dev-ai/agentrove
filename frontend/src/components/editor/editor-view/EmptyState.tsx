import { memo } from 'react';
import { PanelLeft, FileCode2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './EmptyState.module.scss';

export interface EmptyStateProps {
  theme: string;
  onToggleFileTree?: () => void;
  isFileTreeCollapsed?: boolean;
}

export const EmptyState = memo(function EmptyState({
  // `theme` is retained on the public API but the surface token is now theme-aware,
  // so the background no longer needs the resolved theme.
  onToggleFileTree,
  isFileTreeCollapsed = false,
}: EmptyStateProps) {
  return (
    <div className={styles['empty-state']}>
      {/* Reopen affordance only — closing happens from the FILES panel header. */}
      {onToggleFileTree && isFileTreeCollapsed && (
        <div className={styles['empty-state-header']}>
          <Button
            variant="unstyled"
            onClick={onToggleFileTree}
            className={styles['toggle-tree']}
            aria-label="Open file tree"
          >
            <PanelLeft size={14} />
          </Button>
        </div>
      )}
      <div className={styles['empty-state-body']}>
        <FileCode2 className={styles['empty-state-icon']} />
        <span className={styles['empty-state-text']}>Select a file to edit</span>
      </div>
    </div>
  );
});
