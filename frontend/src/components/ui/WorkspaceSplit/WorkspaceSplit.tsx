import { useMemo, ReactNode } from 'react';
import clsx from 'clsx';
import type { TileId } from '@/types/ui.types';
import styles from './WorkspaceSplit.module.scss';

interface WorkspaceSplitProps {
  // Every open tab is mounted so background panes keep state.
  openTabs: TileId[];
  visibleLayout: TileId[][];
  // isVisible false for mounted-but-hidden tabs (skip terminal fit/focus, etc.).
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

// Stable CSS-grid positions (no remount when visibility/row changes). Column count
// is LCM of row lengths so tiles stay equal-width within each row.
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
      className={styles['workspace-split']}
      style={{
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      }}
    >
      {openTabs.map((tileId) => {
        const p = placements.get(tileId);
        if (!p) {
          return (
            <div key={tileId} className={styles['tile-hidden']}>
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
            className={clsx(
              styles.tile,
              p.topBorder && styles['tile--top-border'],
              p.leftBorder && styles['tile--left-border'],
            )}
          >
            {renderView(tileId, true)}
          </div>
        );
      })}
    </div>
  );
}
