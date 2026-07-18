import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronsUpDown, MoreHorizontal, RotateCcw, Undo2 } from 'lucide-react';
import clsx from 'clsx';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Button } from '@/components/ui/primitives/Button/Button';
import { SegmentedControl } from '@/components/ui/primitives/SegmentedControl/SegmentedControl';
import type { FileDiffMetadata } from '@pierre/diffs';
import type { DiffMode } from '@/types/sandbox.types';
import type { useAnchoredPanel } from '@/hooks/useAnchoredPanel';
import {
  DIFF_MODE_OPTIONS,
  DIFF_STYLE_OPTIONS,
  FILES_PANEL_WIDTH,
  OVERFLOW_PANEL_WIDTH,
} from './diffView.utils';
import styles from './DiffToolbar.module.scss';

type AnchoredPanel = ReturnType<typeof useAnchoredPanel>;

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
  canDiscard: boolean;
  discardAllPending: boolean;
  allCollapsed: boolean;
  onToggleAll: () => void;
  onDiscardAll: () => void;
  filesMenu: AnchoredPanel;
  overflowMenu: AnchoredPanel;
  filesSidebar: ReactNode;
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
  canDiscard,
  discardAllPending,
  allCollapsed,
  onToggleAll,
  onDiscardAll,
  filesMenu,
  overflowMenu,
  filesSidebar,
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
      {/* Scope cluster — refresh + which changes to show. */}
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

      {/* Narrow tiles collapse the sidebar into this file switcher. */}
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
          {filesMenu.isOpen &&
            createPortal(
              <div
                ref={filesMenu.panelRef}
                style={{
                  top: filesMenu.pos.top,
                  left: filesMenu.pos.left,
                  width: FILES_PANEL_WIDTH,
                }}
                className={styles['files-panel']}
              >
                {filesSidebar}
              </div>,
              document.body,
            )}
        </>
      )}

      {/* Wide: diffstat sits beside the scope. Narrow: it's pushed right,
          next to the overflow menu (rendered after the spacer below). */}
      {!isNarrow && diffstat}

      <div className={styles.spacer} />

      {isNarrow && diffstat}

      {/* Review progress — a glanceable "how far through this diff am I".
          Hidden on narrow tiles where the toolbar is already tight. */}
      {!isNarrow && showFiles && (
        <div className={styles.progress}>
          <div className={styles['progress-track']}>
            {/* showFiles guarantees parsedFiles is non-empty. */}
            <div
              className={styles['progress-fill']}
              style={{ width: `${(reviewedCount / parsedFiles.length) * 100}%` }}
            />
          </div>
          <span className={styles['progress-label']}>
            {reviewedCount}/{parsedFiles.length} reviewed
          </span>
        </div>
      )}

      {/* Diff style stays inline on wide (the primary always-on preference);
          narrow tucks it into the overflow menu to save room. */}
      {!isNarrow && (
        <SegmentedControl
          options={DIFF_STYLE_OPTIONS}
          value={diffStyle}
          onChange={onDiffStyleChange}
          size="sm"
          className={styles.segmented}
        />
      )}

      {/* Secondary actions (collapse/discard, plus diff style on narrow)
          live in one overflow menu instead of cryptic toolbar icons. On
          wide it only exists when there are files to act on. */}
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
          {overflowMenu.isOpen &&
            createPortal(
              <div
                ref={overflowMenu.panelRef}
                style={{
                  top: overflowMenu.pos.top,
                  left: overflowMenu.pos.left,
                  width: OVERFLOW_PANEL_WIDTH,
                }}
                className={styles['overflow-panel']}
              >
                {showFiles && (
                  <Button variant="unstyled" onClick={onToggleAll} className={styles['menu-item']}>
                    <ChevronsUpDown className={styles['menu-item-icon']} />
                    {allCollapsed ? 'Expand all files' : 'Collapse all files'}
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
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  );
}
