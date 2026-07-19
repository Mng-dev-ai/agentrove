import { lazy, memo, Suspense } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { MONACO_FONT_FAMILY } from '@/config/constants';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './DiffContent.module.scss';

const DiffEditor = lazy(() =>
  // Library module namespace (loader, hooks, components) doesn't fit lazyNamed's
  // Record<string, ComponentType> bound — keep the manual default remap here.
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
  fontSize: 14,
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
  if (isLoading || (!isError && original === undefined)) {
    return (
      <div className={styles['diff-state']}>
        <div className={styles['diff-loading-text']}>Loading changes...</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={styles['diff-state']}>
        <span className={styles['diff-message']}>Failed to load changes</span>
        <Button onClick={onRetry} variant="unstyled" className={styles['diff-retry']}>
          Retry
        </Button>
      </div>
    );
  }

  if (!isGitRepo) {
    return (
      <div className={styles['diff-state']}>
        <GitCompareArrows className={styles['diff-icon']} />
        <span className={styles['diff-message']}>Not a git repository</span>
      </div>
    );
  }

  if (original === modified) {
    return (
      <div className={styles['diff-state']}>
        <GitCompareArrows className={styles['diff-icon']} />
        <span className={styles['diff-message']}>
          {hasGitChanges ? 'No content changes to show' : 'No changes since last commit'}
        </span>
      </div>
    );
  }

  return (
    <div className={styles['diff-content']}>
      <Suspense
        fallback={
          <div className={styles['diff-state']}>
            <div className={styles['diff-loading-text']}>Loading editor...</div>
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
            <div className={styles['diff-state']}>
              <div className={styles['diff-loading-text']}>Loading editor...</div>
            </div>
          }
          className={styles['diff-editor']}
        />
      </Suspense>
    </div>
  );
});
