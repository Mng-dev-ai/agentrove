import { memo, useEffect, useMemo, useRef } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import type { ChangeTypes, FileDiffMetadata } from '@pierre/diffs';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import clsx from 'clsx';
import styles from './DiffFileSidebar.module.scss';

export interface FileChangeStats {
  additions: number;
  deletions: number;
}

// Single-letter badges — the sidebar is too narrow for the full status words.
// Plain `change` rows intentionally have none.
const SIDEBAR_BADGES: Partial<Record<ChangeTypes, { label: string; modifier: string }>> = {
  new: { label: 'N', modifier: styles['badge--new'] },
  deleted: { label: 'D', modifier: styles['badge--deleted'] },
  'rename-pure': { label: 'R', modifier: styles['badge--renamed'] },
  'rename-changed': { label: 'R', modifier: styles['badge--renamed'] },
};

const TICK_SLOTS = [0, 1, 2, 3];

function StatTicks({ additions, deletions }: FileChangeStats) {
  const total = additions + deletions;
  if (total === 0) return null;
  // Fixed tick count split by add/delete ratio; a nonzero side always keeps one
  // tick so a 1-line deletion in a big addition stays visible.
  let addTicks = Math.round((additions / total) * TICK_SLOTS.length);
  if (additions > 0) addTicks = Math.max(addTicks, 1);
  if (deletions > 0) addTicks = Math.min(addTicks, TICK_SLOTS.length - 1);
  return (
    <span className={styles.ticks}>
      {TICK_SLOTS.map((slot) => (
        <span
          key={slot}
          className={clsx(styles.tick, slot < addTicks ? styles['tick--add'] : styles['tick--del'])}
        />
      ))}
    </span>
  );
}

// Tail-biased truncation — the deepest segment disambiguates sibling groups, so
// the head ellipsizes first. CSS-only left-ellipsis (direction: rtl) is not an
// option: bidi reorders slash-separated segments.
function DirLabel({ dir }: { dir: string }) {
  const cut = dir.lastIndexOf('/');
  return (
    <FloatingTooltip content={dir} className={styles['block-full']}>
      <div className={styles['dir-label']}>
        <span className={styles['dir-head']}>{cut === -1 ? dir : dir.slice(0, cut)}</span>
        {cut !== -1 && <span className={styles['dir-tail']}>/{dir.slice(cut + 1)}</span>}
      </div>
    </FloatingTooltip>
  );
}

export const DiffFileSidebar = memo(function DiffFileSidebar({
  files,
  statsByFile,
  totals,
  activeFile,
  onSelectFile,
  reviewedFiles,
}: {
  files: FileDiffMetadata[];
  statsByFile: Map<string, FileChangeStats>;
  totals: FileChangeStats;
  activeFile: string | null;
  onSelectFile: (name: string) => void;
  reviewedFiles: Set<string>;
}) {
  // Files arrive dir-major sorted (DiffView's parsedFiles), so a directory's
  // files are contiguous — consecutive grouping is enough, no tree build needed.
  const groups = useMemo(() => {
    const out: { dir: string; files: FileDiffMetadata[] }[] = [];
    for (const file of files) {
      const cut = file.name.lastIndexOf('/');
      const dir = cut === -1 ? '' : file.name.slice(0, cut);
      const last = out[out.length - 1];
      if (last && last.dir === dir) last.files.push(file);
      else out.push({ dir, files: [file] });
    }
    return out;
  }, [files]);

  // Keep the scrollspy-highlighted row visible as the diff pane scrolls. `files`
  // is a dep too: a refetch can rebuild the list (moving the row) while the
  // active file stays the same.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeFile) return;
    listRef.current
      ?.querySelector(`[data-sidebar-file="${CSS.escape(activeFile)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeFile, files]);

  return (
    <div className={styles.sidebar}>
      <div className={styles['sidebar-header']}>
        <span className={styles['file-count']}>
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <div className={styles.spacer} />
        <span className={styles['stat-add']}>+{totals.additions}</span>
        <span className={styles['stat-del']}>&minus;{totals.deletions}</span>
      </div>

      <div ref={listRef} className={styles.list}>
        {groups.map((group) => (
          <div key={`${group.dir}\0${group.files[0].name}`}>
            {group.dir && <DirLabel dir={group.dir} />}
            {group.files.map((file) => {
              const isActive = file.name === activeFile;
              const isReviewed = reviewedFiles.has(file.name);
              const badge = SIDEBAR_BADGES[file.type];
              const stats = statsByFile.get(file.name);
              return (
                <FloatingTooltip
                  key={file.name}
                  content={
                    stats && (stats.additions > 0 || stats.deletions > 0)
                      ? `${file.name} · +${stats.additions} −${stats.deletions}`
                      : file.name
                  }
                  className={styles['block-full']}
                >
                  <Button
                    variant="unstyled"
                    type="button"
                    data-sidebar-file={file.name}
                    onClick={() => onSelectFile(file.name)}
                    className={clsx(styles['file-row'], isActive && styles['file-row--active'])}
                  >
                    {isReviewed ? (
                      <CheckCircle2
                        className={clsx(styles['review-icon'], styles['review-icon--reviewed'])}
                      />
                    ) : (
                      <Circle
                        className={clsx(styles['review-icon'], styles['review-icon--unreviewed'])}
                      />
                    )}
                    <span
                      className={clsx(
                        styles['file-name'],
                        isActive && styles['file-name--active'],
                        file.type === 'deleted' && styles['file-name--deleted'],
                      )}
                    >
                      {file.name.slice(file.name.lastIndexOf('/') + 1)}
                    </span>
                    {badge && (
                      <span className={clsx(styles.badge, badge.modifier)}>{badge.label}</span>
                    )}
                    {stats && <StatTicks additions={stats.additions} deletions={stats.deletions} />}
                  </Button>
                </FloatingTooltip>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
