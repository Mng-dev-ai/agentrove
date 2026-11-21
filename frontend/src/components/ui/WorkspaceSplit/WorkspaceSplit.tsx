import { useMemo, ReactNode } from 'react';
import clsx from 'clsx';
import { tileColumns, tileRenderKey } from '@/utils/tileHelpers';
import type { TileId } from '@/types/ui.types';
import styles from './WorkspaceSplit.module.scss';

interface WorkspaceSplitProps {
  // Every open tab is mounted so background panes keep state.
  openTabs: TileId[];
  visibleLayout: TileId[][];
  splitChatIds: string[];
  panelHosts: Set<TileId>;
  // isVisible false for mounted-but-hidden tabs (skip terminal fit/focus, etc.).
  renderView: (tileId: TileId, isVisible: boolean) => ReactNode;
}

interface TilePlacement {
  gridRow: number;
  gridColumn: string;
  topBorder: boolean;
  leftBorder: boolean;
}

// Stable CSS-grid positions (no remount when visibility/row changes); tiles stay
// equal-width within each row, beside any open session panel tracks.
export function WorkspaceSplit({
  openTabs,
  visibleLayout,
  splitChatIds,
  panelHosts,
  renderView,
}: WorkspaceSplitProps) {
  const { placements, template } = useMemo(() => {
    const columns = tileColumns(visibleLayout, panelHosts);
    const map = new Map<TileId, TilePlacement>();
    visibleLayout.forEach((row, r) => {
      row.forEach((tileId, c) => {
        map.set(tileId, {
          gridRow: r + 1,
          gridColumn: columns.columnOf.get(tileId) ?? 'auto',
          topBorder: r > 0,
          leftBorder: c > 0,
        });
      });
    });
    return { placements: map, template: columns.template };
  }, [visibleLayout, panelHosts]);

  return (
    <div
      className={styles['workspace-split']}
      style={{
        gridTemplateRows: `repeat(${visibleLayout.length}, minmax(0, 1fr))`,
        gridTemplateColumns: template,
      }}
    >
      {openTabs.map((tileId) => {
        const p = placements.get(tileId);
        if (!p) {
          return (
            <div key={tileRenderKey(tileId, splitChatIds)} className={styles['tile-hidden']}>
              {renderView(tileId, false)}
            </div>
          );
        }
        return (
          <div
            key={tileRenderKey(tileId, splitChatIds)}
            style={{
              gridRow: p.gridRow,
              gridColumn: p.gridColumn,
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
