import { memo, useEffect, useMemo, useRef } from 'react';
import { Undo2 } from 'lucide-react';
import type { FileDiffMetadata } from '@pierre/diffs';
import { Button } from '@/components/ui/primitives/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { cn } from '@/utils/cn';

export interface FileChangeStats {
  additions: number;
  deletions: number;
}

// Single-letter badges — the sidebar is too narrow for the full status words.
const SIDEBAR_BADGES: Record<string, { label: string; className: string }> = {
  new: {
    label: 'N',
    className: 'bg-success-600/15 text-success-600 dark:bg-success-400/15 dark:text-success-400',
  },
  deleted: {
    label: 'D',
    className: 'bg-error-600/15 text-error-600 dark:bg-error-400/15 dark:text-error-400',
  },
  'rename-pure': {
    label: 'R',
    className: 'bg-warning-600/15 text-warning-600 dark:bg-warning-400/15 dark:text-warning-400',
  },
  'rename-changed': {
    label: 'R',
    className: 'bg-warning-600/15 text-warning-600 dark:bg-warning-400/15 dark:text-warning-400',
  },
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
    <span className="flex shrink-0 items-center gap-px">
      {TICK_SLOTS.map((slot) => (
        <span
          key={slot}
          className={cn(
            'h-2 w-1 rounded-[1px]',
            slot < addTicks
              ? 'bg-success-600/75 dark:bg-success-400/75'
              : 'bg-error-600/75 dark:bg-error-400/75',
          )}
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
    <FloatingTooltip content={dir} className="block w-full">
      <div className="flex overflow-hidden px-3 pb-0.5 pt-1.5 font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
        <span className="min-w-0 truncate">{cut === -1 ? dir : dir.slice(0, cut)}</span>
        {cut !== -1 && <span className="shrink-0">/{dir.slice(cut + 1)}</span>}
      </div>
    </FloatingTooltip>
  );
}

export const DiffFileSidebar = memo(function DiffFileSidebar({
  files,
  statsByFile,
  activeFile,
  onSelectFile,
  canDiscard,
  onDiscardAll,
  discardPending,
}: {
  files: FileDiffMetadata[];
  statsByFile: Map<string, FileChangeStats>;
  activeFile: string | null;
  onSelectFile: (name: string) => void;
  canDiscard: boolean;
  onDiscardAll: () => void;
  discardPending: boolean;
}) {
  // Git emits paths sorted, so same-directory files are contiguous — consecutive
  // grouping is enough, no tree build needed.
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

  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    statsByFile.forEach((stats) => {
      additions += stats.additions;
      deletions += stats.deletions;
    });
    return { additions, deletions };
  }, [statsByFile]);

  // Keep the scrollspy-highlighted row visible as the diff pane scrolls.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeFile) return;
    listRef.current
      ?.querySelector(`[data-sidebar-file="${CSS.escape(activeFile)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeFile]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2 dark:border-border-dark/50">
        <span className="text-2xs font-medium text-text-secondary dark:text-text-dark-secondary">
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <div className="min-w-0 flex-1" />
        <span className="font-mono text-2xs text-success-600 dark:text-success-400">
          +{totals.additions}
        </span>
        <span className="font-mono text-2xs text-error-600 dark:text-error-400">
          &minus;{totals.deletions}
        </span>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {groups.map((group) => (
          <div key={`${group.dir}\0${group.files[0].name}`}>
            {group.dir && <DirLabel dir={group.dir} />}
            {group.files.map((file) => {
              const isActive = file.name === activeFile;
              const badge = file.type ? SIDEBAR_BADGES[file.type] : undefined;
              const stats = statsByFile.get(file.name);
              return (
                <FloatingTooltip
                  key={file.name}
                  content={
                    stats && (stats.additions > 0 || stats.deletions > 0)
                      ? `${file.name} · +${stats.additions} −${stats.deletions}`
                      : file.name
                  }
                  className="block w-full"
                >
                  <Button
                    variant="unstyled"
                    type="button"
                    data-sidebar-file={file.name}
                    onClick={() => onSelectFile(file.name)}
                    className={cn(
                      'flex w-full items-center gap-1.5 border-l-2 py-1 pl-4 pr-3 text-left transition-colors duration-200',
                      isActive
                        ? 'border-text-primary bg-surface-active dark:border-text-dark-primary dark:bg-surface-dark-active'
                        : 'border-transparent hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
                    )}
                  >
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate font-mono text-2xs',
                        isActive
                          ? 'text-text-primary dark:text-text-dark-primary'
                          : 'text-text-secondary dark:text-text-dark-secondary',
                        file.type === 'deleted' && 'line-through opacity-70',
                      )}
                    >
                      {file.name.slice(file.name.lastIndexOf('/') + 1)}
                    </span>
                    {badge && (
                      <span
                        className={cn(
                          'shrink-0 rounded px-1 py-0.5 text-[9px] font-medium leading-none',
                          badge.className,
                        )}
                      >
                        {badge.label}
                      </span>
                    )}
                    {stats && <StatTicks additions={stats.additions} deletions={stats.deletions} />}
                  </Button>
                </FloatingTooltip>
              );
            })}
          </div>
        ))}
      </div>

      {canDiscard && (
        <div className="shrink-0 border-t border-border/50 p-1.5 dark:border-border-dark/50">
          <Button
            variant="unstyled"
            type="button"
            disabled={discardPending}
            onClick={onDiscardAll}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
          >
            <Undo2 className="h-3 w-3" />
            Discard all changes
          </Button>
        </div>
      )}
    </div>
  );
});
