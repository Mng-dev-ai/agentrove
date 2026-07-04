import { memo, lazy, Suspense } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { MONACO_FONT_FAMILY } from '@/config/constants';
import { Button } from '@/components/ui/primitives/Button';
import { cn } from '@/utils/cn';

const DiffEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.DiffEditor })),
);

const DIFF_OPTIONS = {
  readOnly: true,
  originalEditable: false,
  renderSideBySide: true,
  // Collapses to the inline view when the editor pane is too narrow for split.
  useInlineViewWhenSpaceIsLimited: true,
  hideUnchangedRegions: { enabled: true },
  renderOverviewRuler: false,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  padding: { top: 8, bottom: 8 },
  automaticLayout: true,
  fontFamily: MONACO_FONT_FAMILY,
  fontSize: 12,
  lineHeight: 1.5,
  renderLineHighlight: 'none',
  scrollbar: {
    useShadows: false,
    vertical: 'auto',
    horizontal: 'auto',
    horizontalScrollbarSize: 6,
    verticalScrollbarSize: 6,
  },
  guides: {
    indentation: false,
  },
  stickyScroll: { enabled: false },
  smoothScrolling: true,
} as const;

export interface DiffContentProps {
  // HEAD version of the file; undefined until the baseline query resolves.
  original: string | undefined;
  modified: string;
  language: string;
  theme: string;
  isLoading: boolean;
  isError: boolean;
  isGitRepo: boolean;
  // Git can report the path changed while the contents match (staged-only
  // change, new empty file) — don't claim the file matches the last commit then.
  hasGitChanges: boolean;
  onRetry: () => void;
  onBeforeMount: (monaco: typeof import('monaco-editor')) => void;
}

export const DiffContent = memo(function DiffContent({
  original,
  modified,
  language,
  theme,
  isLoading,
  isError,
  isGitRepo,
  hasGitChanges,
  onRetry,
  onBeforeMount,
}: DiffContentProps) {
  const stateClassName = cn(
    'flex h-full w-full flex-col items-center justify-center gap-2',
    'bg-surface-secondary dark:bg-surface-dark-secondary',
  );

  if (isLoading || (!isError && original === undefined)) {
    return (
      <div className={stateClassName}>
        <div className="animate-pulse text-xs text-text-quaternary dark:text-text-dark-quaternary">
          Loading changes...
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={stateClassName}>
        <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
          Failed to load changes
        </span>
        <Button
          onClick={onRetry}
          variant="unstyled"
          className="text-2xs text-text-tertiary underline transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-tertiary dark:hover:text-text-dark-secondary"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!isGitRepo) {
    return (
      <div className={stateClassName}>
        <GitCompareArrows className="h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
        <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
          Not a git repository
        </span>
      </div>
    );
  }

  if (original === modified) {
    return (
      <div className={stateClassName}>
        <GitCompareArrows className="h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
        <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
          {hasGitChanges ? 'No content changes to show' : 'No changes since last commit'}
        </span>
      </div>
    );
  }

  return (
    <div className="h-full">
      <Suspense
        fallback={
          <div className={stateClassName}>
            <div className="animate-pulse text-xs text-text-quaternary dark:text-text-dark-quaternary">
              Loading editor...
            </div>
          </div>
        }
      >
        <DiffEditor
          height="100%"
          language={language}
          original={original}
          modified={modified}
          theme={theme}
          options={DIFF_OPTIONS}
          beforeMount={onBeforeMount}
          loading={
            <div className={stateClassName}>
              <div className="animate-pulse text-xs text-text-quaternary dark:text-text-dark-quaternary">
                Loading editor...
              </div>
            </div>
          }
          className="bg-surface-secondary dark:bg-surface-dark-secondary"
        />
      </Suspense>
    </div>
  );
});
