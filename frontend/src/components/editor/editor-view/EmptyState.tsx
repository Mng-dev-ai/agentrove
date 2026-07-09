import { memo } from 'react';
import { PanelLeft, FileCode2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { cn } from '@/utils/cn';

export interface EmptyStateProps {
  theme: string;
  onToggleFileTree?: () => void;
  isFileTreeCollapsed?: boolean;
}

export const EmptyState = memo(function EmptyState({
  theme,
  onToggleFileTree,
  isFileTreeCollapsed = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex h-full flex-col',
        theme === 'light' ? 'bg-surface-secondary' : 'bg-surface-dark-secondary',
      )}
    >
      {/* Reopen affordance only — closing happens from the FILES panel header. */}
      {onToggleFileTree && isFileTreeCollapsed && (
        <div className="flex h-9 items-center border-b border-border/50 px-3 dark:border-border-dark/50">
          <Button
            variant="unstyled"
            onClick={onToggleFileTree}
            className="shrink-0 rounded-md p-1 text-text-quaternary transition-colors duration-150 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
            aria-label="Open file tree"
          >
            <PanelLeft size={14} />
          </Button>
        </div>
      )}
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <FileCode2 className="h-8 w-8 text-text-quaternary dark:text-text-dark-quaternary" />
        <span className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
          Select a file to edit
        </span>
      </div>
    </div>
  );
});
