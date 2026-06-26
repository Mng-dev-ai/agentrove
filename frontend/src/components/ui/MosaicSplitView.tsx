import { useCallback, useMemo, ReactNode } from 'react';
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import { useUIStore } from '@/store/uiStore';
import { cn } from '@/utils/cn';
import { getLeaves, mosaicLayoutToLibrary, libraryToMosaicLayout } from '@/utils/mosaicHelpers';
import type { MosaicLayoutNode, MosaicTileId } from '@/types/ui.types';

import 'react-mosaic-component/react-mosaic-component.css';
import '@/styles/mosaic-theme.css';

interface MosaicSplitViewProps {
  mosaicLayout: MosaicLayoutNode;
  renderView: (tileId: MosaicTileId, slot: string) => ReactNode;
}

export function MosaicSplitView({ mosaicLayout, renderView }: MosaicSplitViewProps) {
  // Pane titles/controls live in the title bar's SplitTabs; the maximize state is
  // shared via the store so the tab toggle and this CSS expansion stay in sync.
  // Derived on read: a maximizedTile that's no longer a leaf (after any single-tile
  // transition) is treated as cleared, so the store never needs to chase it.
  const rawMaximized = useUIStore((s) => s.maximizedTile);

  const handleMosaicChange = useCallback((newNode: Parameters<typeof libraryToMosaicLayout>[0]) => {
    const layout = libraryToMosaicLayout(newNode);
    useUIStore.getState().setMosaicLayout(layout);
  }, []);

  const leaves = useMemo(() => getLeaves(mosaicLayout), [mosaicLayout]);
  const maximizedTile = rawMaximized && leaves.includes(rawMaximized) ? rawMaximized : null;

  const libraryValue = useMemo(() => mosaicLayoutToLibrary(mosaicLayout), [mosaicLayout]);

  return (
    <div
      className={cn(
        'mosaic-agentrove flex h-full flex-1 overflow-hidden',
        // Keeps the whole tree mounted (sibling panes retain local state); CSS
        // expands the maximized tile over the rest.
        maximizedTile && 'has-maximized',
      )}
    >
      <Mosaic<string>
        value={libraryValue}
        onChange={handleMosaicChange}
        className=""
        renderTile={(id, path) => {
          const tileId = id as MosaicTileId;
          return (
            <MosaicWindow<string>
              path={path}
              className={maximizedTile === tileId ? 'mosaic-window--maximized' : undefined}
              // title is a required prop but never renders — labels/controls live
              // in the title-bar SplitTabs and the per-pane toolbar renders empty.
              title={tileId}
              // draggable=false skips react-dnd's connectDragSource on the empty
              // toolbar — passing a Fragment to the connector throws in react-dnd 16,
              // and there's no grab target anyway since the toolbar renders empty.
              draggable={false}
              renderToolbar={() => <></>}
            >
              <div className="flex h-full w-full overflow-hidden">
                {renderView(tileId, `tile-${tileId}`)}
              </div>
            </MosaicWindow>
          );
        }}
        resize={{ minimumPaneSizePercentage: 15 }}
      />
    </div>
  );
}
