import { memo, lazy, Suspense } from 'react';
import type * as monaco from 'monaco-editor';
import { MONACO_FONT_FAMILY } from '@/config/constants';
import styles from './Content.module.scss';

const Editor = lazy(() => import('@monaco-editor/react'));

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  padding: { top: 8, bottom: 8 },
  automaticLayout: true,
  suggestOnTriggerCharacters: true,
  quickSuggestions: {
    other: true,
    comments: true,
    strings: true,
  },
  snippetSuggestions: 'inline',
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
  overviewRulerBorder: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  guides: {
    indentation: false,
  },
  renderLineHighlightOnlyWhenFocus: true,
  // On by default since monaco 0.44; the peek preview inherits it and burns
  // rows on pinned ancestor scopes in an already-small viewport.
  stickyScroll: { enabled: false },
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  smoothScrolling: true,
} as const;

export interface ContentProps {
  content: string;
  language: string;
  modelPath: string;
  isReadOnly: boolean;
  onChange: (value: string | undefined) => void;
  onMount: (
    editor: monaco.editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor'),
  ) => void;
  theme: string;
}

export const Content = memo(function Content({
  content,
  language,
  modelPath,
  isReadOnly,
  onChange,
  onMount,
  theme,
}: ContentProps) {
  // Surface tokens track the active palette's CSS vars, matching Monaco's
  // editor.background for every palette — not just the default light/dark.
  const loadingFallback = (
    <div className={styles['content-loading']}>
      <div className={styles['content-loading-pulse']}>Loading editor...</div>
    </div>
  );

  return (
    <div className={styles.content}>
      <Suspense fallback={loadingFallback}>
        <Editor
          height="100%"
          language={language}
          path={modelPath}
          value={content}
          onChange={onChange}
          theme={theme}
          options={{
            ...EDITOR_OPTIONS,
            readOnly: isReadOnly,
          }}
          onMount={onMount}
          loading={
            <div className={styles['content-loading']}>
              <div className={styles['content-loading-pulse']}>Loading editor...</div>
            </div>
          }
          className={styles['content-editor']}
        />
      </Suspense>
    </div>
  );
});
