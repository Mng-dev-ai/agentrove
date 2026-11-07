import type { ReactNode } from 'react';
import {
  ChevronDown,
  ChevronsUpDown,
  Keyboard,
  MessageSquare,
  MoreHorizontal,
  RotateCcw,
  Square,
  SquareCheck,
  Undo2,
} from 'lucide-react';
import clsx from 'clsx';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Button } from '@/components/ui/primitives/Button/Button';
import { SegmentedControl } from '@/components/ui/primitives/SegmentedControl/SegmentedControl';
import type { FileDiffMetadata } from '@pierre/diffs';
import type { DiffMode } from '@/types/sandbox.types';
import type { DiffShortcut } from './useDiffShortcuts';
import {
  COMMENTS_PANEL_WIDTH,
  DIFF_MODE_OPTIONS,
  DIFF_STYLE_OPTIONS,
  FILES_PANEL_WIDTH,
  OVERFLOW_PANEL_WIDTH,
} from './diffView.utils';
import { DiffToolbarPanel, type AnchoredPanel } from './DiffToolbarPanel';
import styles from './DiffToolbar.module.scss';

interface DiffToolbarProps {
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
  diffStyle: 'unified' | 'split';
  onDiffStyleChange: (style: 'unified' | 'split') => void;
  isFetching: boolean;
  onRefetch: () => void;
  isNarrow: boolean;
  showFiles: boolean;
  currentFile: string | null;
  parsedFiles: FileDiffMetadata[];
  totals: { additions: number; deletions: number };
  reviewedCount: number;
  onNextUnreviewed: () => void;
  canDiscard: boolean;
  discardAllPending: boolean;
  allCollapsed: boolean;
  onToggleAll: () => void;
  ignoreWhitespace: boolean;
  onToggleWhitespace: () => void;
  onDiscardAll: () => void;
  filesMenu: AnchoredPanel;
  overflowMenu: AnchoredPanel;
  filesSidebar: ReactNode;
  commentCount: number;
  commentsMenu: AnchoredPanel;
  commentsPanel: ReactNode;
  overflowView: 'menu' | 'shortcuts';
  onShowShortcuts: () => void;
  shortcuts: DiffShortcut[];
}

export function DiffToolbar({
  mode,
  onModeChange,
  diffStyle,
  onDiffStyleChange,
  isFetching,
  onRefetch,
  isNarrow,
  showFiles,
  currentFile,
  parsedFiles,
  totals,
  reviewedCount,
  onNextUnreviewed,
  canDiscard,
  discardAllPending,
  allCollapsed,
  onToggleAll,
  ignoreWhitespace,
  onToggleWhitespace,
  onDiscardAll,
  filesMenu,
  overflowMenu,
  filesSidebar,
  commentCount,
  commentsMenu,
  commentsPanel,
  overflowView,
  onShowShortcuts,
  shortcuts,
}: DiffToolbarProps) {
  // Diffstat surfaced in the toolbar so change size stays visible when the
  // sidebar is collapsed (narrow tiles) or scrolled away.
  const diffstat = showFiles ? (
    <div className={styles.diffstat}>
      <span className={styles['stat-add']}>+{totals.additions}</span>
      <span className={styles['stat-del']}>&minus;{totals.deletions}</span>
    </div>
  ) : null;

  return (
    <div className={styles.toolbar}>
      <FloatingTooltip content="Refresh diff" className={styles['tooltip-inline']}>
        <Button
          onClick={onRefetch}
          variant="unstyled"
          className={styles['icon-button']}
          aria-label="Refresh diff"
        >
          <RotateCcw
            className={clsx(styles['refresh-icon'], isFetching && styles['refresh-icon--spinning'])}
          />
        </Button>
      </FloatingTooltip>

      <SegmentedControl
        options={DIFF_MODE_OPTIONS}
        value={mode}
        onChange={onModeChange}
        size="sm"
        className={styles.segmented}
      />

      {/* Narrow: sidebar collapses into this file switcher. */}
      {isNarrow && showFiles && currentFile && (
        <>
          <Button
            ref={filesMenu.triggerRef}
            onClick={filesMenu.toggle}
            variant="unstyled"
            aria-haspopup="menu"
            aria-expanded={filesMenu.isOpen}
            className={styles['file-switch']}
          >
            <span className={styles['file-switch-name']}>
              {currentFile.slice(currentFile.lastIndexOf('/') + 1)}
            </span>
            <span className={styles['file-switch-count']}>
              {parsedFiles.findIndex((f) => f.name === currentFile) + 1}/{parsedFiles.length}
            </span>
            <ChevronDown
              className={clsx(
                styles['file-switch-chevron'],
                filesMenu.isOpen && styles['file-switch-chevron--open'],
              )}
            />
          </Button>
          <DiffToolbarPanel
            panel={filesMenu}
            width={FILES_PANEL_WIDTH}
            className={styles['files-panel']}
          >
            {filesSidebar}
          </DiffToolbarPanel>
        </>
      )}

      {/* Wide: diffstat beside scope; narrow: after spacer, next to overflow. */}
      {!isNarrow && diffstat}

      <div className={styles.spacer} />

      {isNarrow && diffstat}

      {commentCount > 0 && (
        <>
          <Button
            ref={commentsMenu.triggerRef}
            onClick={commentsMenu.toggle}
            variant="unstyled"
            aria-haspopup="dialog"
            aria-expanded={commentsMenu.isOpen}
            aria-label={`${commentCount} pending ${commentCount === 1 ? 'comment' : 'comments'}`}
            className={styles.chip}
          >
            <MessageSquare className={styles['menu-item-icon']} />
            {isNarrow
              ? commentCount
              : `${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`}
          </Button>
          <DiffToolbarPanel
            panel={commentsMenu}
            width={COMMENTS_PANEL_WIDTH}
            className={clsx(styles['overflow-panel'], styles['comments-panel'])}
          >
            {commentsPanel}
          </DiffToolbarPanel>
        </>
      )}

      {showFiles && (
        <FloatingTooltip
          content={
            reviewedCount === parsedFiles.length ? 'All files reviewed' : 'Next unreviewed file'
          }
          className={styles['tooltip-inline']}
        >
          <Button
            variant="unstyled"
            onClick={onNextUnreviewed}
            disabled={reviewedCount === parsedFiles.length}
            className={styles.progress}
          >
            {!isNarrow && (
              <div className={styles['progress-track']}>
                {/* showFiles guarantees parsedFiles is non-empty. */}
                <div
                  className={styles['progress-fill']}
                  style={{ width: `${(reviewedCount / parsedFiles.length) * 100}%` }}
                />
              </div>
            )}
            <span className={styles['progress-label']}>
              {reviewedCount}/{parsedFiles.length}
              {!isNarrow && ' reviewed'}
            </span>
          </Button>
        </FloatingTooltip>
      )}

      {/* Diff style inline on wide; narrow tucks it into the overflow menu. */}
      {!isNarrow && (
        <SegmentedControl
          options={DIFF_STYLE_OPTIONS}
          value={diffStyle}
          onChange={onDiffStyleChange}
          size="sm"
          className={styles.segmented}
        />
      )}

      {/* Overflow: collapse/discard (+ diff style on narrow). Wide only when files exist. */}
      {(isNarrow || showFiles) && (
        <>
          <Button
            ref={overflowMenu.triggerRef}
            onClick={overflowMenu.toggle}
            variant="unstyled"
            aria-haspopup="menu"
            aria-expanded={overflowMenu.isOpen}
            aria-label="More diff options"
            className={styles['icon-button']}
          >
            <MoreHorizontal className={styles['overflow-icon']} />
          </Button>
          <DiffToolbarPanel
            panel={overflowMenu}
            width={OVERFLOW_PANEL_WIDTH}
            className={styles['overflow-panel']}
          >
            {overflowView === 'shortcuts' ? (
              shortcuts.map((shortcut) => (
                <div key={shortcut.key} className={styles['shortcut-row']}>
                  {shortcut.label}
                  <kbd className={styles.kbd}>{shortcut.key}</kbd>
                </div>
              ))
            ) : (
              <>
                {showFiles && (
                  <Button variant="unstyled" onClick={onToggleAll} className={styles['menu-item']}>
                    <ChevronsUpDown className={styles['menu-item-icon']} />
                    {allCollapsed ? 'Expand all files' : 'Collapse all files'}
                  </Button>
                )}
                {showFiles && (
                  <Button
                    variant="unstyled"
                    role="menuitemcheckbox"
                    aria-checked={ignoreWhitespace}
                    onClick={onToggleWhitespace}
                    className={styles['menu-item']}
                  >
                    {ignoreWhitespace ? (
                      <SquareCheck className={styles['menu-item-icon']} />
                    ) : (
                      <Square className={styles['menu-item-icon']} />
                    )}
                    Ignore whitespace
                  </Button>
                )}
                {showFiles && canDiscard && (
                  <Button
                    variant="unstyled"
                    disabled={discardAllPending}
                    onClick={onDiscardAll}
                    className={styles['menu-item']}
                  >
                    <Undo2 className={styles['menu-item-icon']} />
                    Discard all changes
                  </Button>
                )}
                {showFiles && (
                  <Button
                    variant="unstyled"
                    onClick={onShowShortcuts}
                    className={styles['menu-item']}
                  >
                    <Keyboard className={styles['menu-item-icon']} />
                    Keyboard shortcuts
                    <kbd className={clsx(styles.kbd, styles['kbd--end'])}>?</kbd>
                  </Button>
                )}
                {isNarrow && showFiles && <div className={styles['menu-divider']} />}
                {isNarrow && (
                  <div className={styles['style-row']}>
                    <span className={styles['style-row-label']}>Diff style</span>
                    <SegmentedControl
                      options={DIFF_STYLE_OPTIONS}
                      value={diffStyle}
                      onChange={onDiffStyleChange}
                      size="sm"
                    />
                  </div>
                )}
              </>
            )}
          </DiffToolbarPanel>
        </>
      )}
    </div>
  );
}
