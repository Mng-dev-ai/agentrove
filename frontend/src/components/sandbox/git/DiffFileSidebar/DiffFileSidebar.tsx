import { memo, useEffect, useMemo, useRef } from 'react';
import { CheckCircle2, ChevronRight, Circle, MessageSquare, Search } from 'lucide-react';
import type { ChangeTypes, FileDiffMetadata } from '@pierre/diffs';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import type { DiffComment } from '@/store/diffCommentsStore';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import clsx from 'clsx';
import styles from './DiffFileSidebar.module.scss';

export interface FileChangeStats {
  additions: number;
  deletions: number;
}

export interface SidebarFilter {
  query: string;
  hideReviewed: boolean;
  onlyCommented: boolean;
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
function DirLabel({
  dir,
  fileCount,
  isCollapsed,
  onToggle,
}: {
  dir: string;
  fileCount: number;
  isCollapsed: boolean;
  onToggle: (dir: string) => void;
}) {
  const cut = dir.lastIndexOf('/');
  return (
    <FloatingTooltip content={dir} className={styles['block-full']}>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onToggle(dir)}
        aria-expanded={!isCollapsed}
        className={styles['dir-label']}
      >
        <ChevronRight
          className={clsx(styles['dir-chevron'], !isCollapsed && styles['dir-chevron--open'])}
        />
        <span className={styles['dir-head']}>{cut === -1 ? dir : dir.slice(0, cut)}</span>
        {cut !== -1 && <span className={styles['dir-tail']}>/{dir.slice(cut + 1)}</span>}
        {isCollapsed && <span className={styles['dir-count']}>{fileCount}</span>}
      </Button>
    </FloatingTooltip>
  );
}

function FilterToggle({
  label,
  isOn,
  onToggle,
}: {
  label: string;
  isOn: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="unstyled"
      type="button"
      aria-pressed={isOn}
      onClick={onToggle}
      className={clsx(styles['filter-toggle'], isOn && styles['filter-toggle--on'])}
    >
      {label}
    </Button>
  );
}

export const DiffFileSidebar = memo(function DiffFileSidebar({
  files,
  statsByFile,
  totals,
  activeFile,
  onSelectFile,
  reviewedFiles,
  commentsByFile,
  filter,
  onFilterChange,
  collapsedDirs,
  onToggleDir,
}: {
  files: FileDiffMetadata[];
  statsByFile: Map<string, FileChangeStats>;
  totals: FileChangeStats;
  activeFile: string | null;
  onSelectFile: (name: string) => void;
  reviewedFiles: Set<string>;
  commentsByFile: Map<string, DiffComment[]>;
  filter: SidebarFilter;
  onFilterChange: (filter: SidebarFilter) => void;
  collapsedDirs: Set<string>;
  onToggleDir: (dir: string) => void;
}) {
  // Files arrive dir-major sorted (DiffView's parsedFiles), so a directory's
  // files are contiguous — consecutive grouping is enough, no tree build needed.
  const groups = useMemo(() => {
    const query = filter.query.trim().toLowerCase();
    const out: { dir: string; files: FileDiffMetadata[] }[] = [];
    for (const file of files) {
      if (query && !file.name.toLowerCase().includes(query)) continue;
      if (filter.hideReviewed && reviewedFiles.has(file.name)) continue;
      if (filter.onlyCommented && !commentsByFile.has(file.name)) continue;
      const cut = file.name.lastIndexOf('/');
      const dir = cut === -1 ? '' : file.name.slice(0, cut);
      const last = out[out.length - 1];
      if (last && last.dir === dir) last.files.push(file);
      else out.push({ dir, files: [file] });
    }
    return out;
  }, [files, filter, reviewedFiles, commentsByFile]);

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
      <div className={styles.filter}>
        <div className={styles['filter-field']}>
          <Search className={styles['filter-icon']} />
          <Input
            variant="unstyled"
            value={filter.query}
            onChange={(event) => onFilterChange({ ...filter, query: event.target.value })}
            placeholder="Filter files"
            aria-label="Filter files"
            className={styles['filter-input']}
          />
        </div>
        <div className={styles['filter-toggles']}>
          <FilterToggle
            label="Hide reviewed"
            isOn={filter.hideReviewed}
            onToggle={() => onFilterChange({ ...filter, hideReviewed: !filter.hideReviewed })}
          />
          <FilterToggle
            label="Only commented"
            isOn={filter.onlyCommented}
            onToggle={() => onFilterChange({ ...filter, onlyCommented: !filter.onlyCommented })}
          />
        </div>
      </div>
      <div className={styles['sidebar-header']}>
        <span className={styles['file-count']}>
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <div className={styles.spacer} />
        <span className={styles['stat-add']}>+{totals.additions}</span>
        <span className={styles['stat-del']}>&minus;{totals.deletions}</span>
      </div>

      <div ref={listRef} className={styles.list}>
        {groups.length === 0 && <div className={styles.empty}>No matching files</div>}
        {groups.map((group) => (
          <div key={`${group.dir}\0${group.files[0].name}`}>
            {group.dir && (
              <DirLabel
                dir={group.dir}
                fileCount={group.files.length}
                isCollapsed={collapsedDirs.has(group.dir)}
                onToggle={onToggleDir}
              />
            )}
            {!collapsedDirs.has(group.dir) &&
              group.files.map((file) => {
                const commentCount = commentsByFile.get(file.name)?.length ?? 0;
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
                      {commentCount > 0 && (
                        <span className={styles['comment-count']}>
                          <MessageSquare className={styles['comment-icon']} />
                          {commentCount}
                        </span>
                      )}
                      {badge && (
                        <span className={clsx(styles.badge, badge.modifier)}>{badge.label}</span>
                      )}
                      {stats && (
                        <StatTicks additions={stats.additions} deletions={stats.deletions} />
                      )}
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
