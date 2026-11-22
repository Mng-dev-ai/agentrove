import { useMemo, ReactNode } from 'react';
import clsx from 'clsx';
import { PaneSessionPanelSlot } from '@/components/chat/session-panel/PaneSessionPanel';
import { tileGrid, tileRenderKey } from '@/utils/tileHelpers';
import type { AgentTileId, TileId } from '@/types/ui.types';
import styles from './WorkspaceSplit.module.scss';

interface WorkspaceSplitProps {
  // Every open tab is mounted so background panes keep state.
  openTabs: TileId[];
  visibleLayout: TileId[][];
  splitChatIds: string[];
  openPanelTiles: AgentTileId[];
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
// equal-width within each row, beside the open session panels' tracks.
export function WorkspaceSplit({
  openTabs,
  visibleLayout,
  splitChatIds,
  openPanelTiles,
  renderView,
}: WorkspaceSplitProps) {
  const { placements, template, panels } = useMemo(() => {
    const grid = tileGrid(visibleLayout, openPanelTiles);
    const map = new Map<TileId, TilePlacement>();
    visibleLayout.forEach((row, r) => {
      row.forEach((tileId, c) => {
        map.set(tileId, {
          gridRow: r + 1,
          gridColumn: grid.columnOf.get(tileId) ?? 'auto',
          topBorder: r > 0,
          leftBorder: c > 0,
        });
      });
    });
    return { placements: map, template: grid.template, panels: grid.panels };
  }, [visibleLayout, openPanelTiles]);

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
      {panels.map((panel) => (
        <div
          key={panel.agentTile}
          style={{ gridRow: panel.gridRow, gridColumn: panel.gridColumn }}
          className={clsx(styles.tile, panel.firstRow > 0 && styles['tile--top-border'])}
        >
          <PaneSessionPanelSlot agentTile={panel.agentTile} headed={panel.firstRow > 0} />
        </div>
      ))}
    </div>
  );
}
