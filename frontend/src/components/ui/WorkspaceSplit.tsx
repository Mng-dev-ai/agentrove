import { useMemo, ReactNode } from 'react';
import { cn } from '@/utils/cn';
import type { TileId } from '@/types/ui.types';

interface WorkspaceSplitProps {
  // All open tabs — every one is mounted so background panes keep their state.
  openTabs: TileId[];
  // Rows of on-screen tiles: rows stack vertically, tiles in a row sit side by side.
  visibleLayout: TileId[][];
  // `isVisible` tells the renderer whether this tile is currently on screen — a
  // background tab is mounted but hidden, so visibility-driven effects (terminal
  // fit/focus) must not fire for it.
  renderView: (tileId: TileId, isVisible: boolean) => ReactNode;
}

interface TilePlacement {
  gridRow: number;
  columnStart: number;
  columnSpan: number;
  topBorder: boolean;
  leftBorder: boolean;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

// Flat split via CSS grid: every open tab renders in a stable position (no remount
// when it moves between visible and background, or between rows); only its grid
// placement and `display` change. Rows share a column grid sized to the LCM of the
// row lengths so tiles in differently-sized rows stay equal-width within their row.
export function WorkspaceSplit({ openTabs, visibleLayout, renderView }: WorkspaceSplitProps) {
  const { placements, rows, cols } = useMemo(() => {
    const rowCount = visibleLayout.length;
    const colCount = visibleLayout.reduce((acc, row) => lcm(acc, row.length), 1);
    const map = new Map<TileId, TilePlacement>();
    visibleLayout.forEach((row, r) => {
      const span = colCount / row.length;
      row.forEach((tileId, c) => {
        map.set(tileId, {
          gridRow: r + 1,
          columnStart: c * span + 1,
          columnSpan: span,
          topBorder: r > 0,
          leftBorder: c > 0,
        });
      });
    });
    return { placements: map, rows: rowCount, cols: colCount };
  }, [visibleLayout]);

  return (
    <div
      className="grid h-full w-full flex-1 overflow-hidden"
      style={{
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      }}
    >
      {openTabs.map((tileId) => {
        const p = placements.get(tileId);
        if (!p) {
          // Mounted but off-screen — kept alive so its state survives.
          return (
            <div key={tileId} className="hidden">
              {renderView(tileId, false)}
            </div>
          );
        }
        return (
          <div
            key={tileId}
            style={{
              gridRow: p.gridRow,
              gridColumn: `${p.columnStart} / span ${p.columnSpan}`,
            }}
            className={cn(
              'flex min-h-0 min-w-0 overflow-hidden',
              p.topBorder && 'border-t border-border/50 dark:border-border-dark/50',
              p.leftBorder && 'border-l border-border/50 dark:border-border-dark/50',
            )}
          >
            {renderView(tileId, true)}
          </div>
        );
      })}
    </div>
  );
}
