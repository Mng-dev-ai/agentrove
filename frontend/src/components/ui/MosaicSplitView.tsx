import { useCallback, useMemo, useState, ReactNode } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import { X, SplitSquareHorizontal, Maximize2, Minimize2 } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { cn } from '@/utils/cn';
import {
  mosaicLayoutToLibrary,
  libraryToMosaicLayout,
  getLeaves,
  tileIdToViewType,
  VIEW_LABELS,
} from '@/utils/mosaicHelpers';
import type { MosaicLayoutNode, MosaicTileId } from '@/types/ui.types';

import 'react-mosaic-component/react-mosaic-component.css';
import '@/styles/mosaic-theme.css';

const TOOLBAR_BUTTON_CLASS = cn(
  'flex items-center justify-center',
  'h-5 w-5 rounded-md',
  'text-text-tertiary dark:text-text-dark-tertiary',
  'hover:text-text-primary dark:hover:text-text-dark-primary',
  'transition-colors duration-200',
);

function getTileLabel(
  tileId: MosaicTileId,
  agentTitles: Partial<Record<MosaicTileId, string>>,
): string {
  return agentTitles[tileId] ?? VIEW_LABELS[tileIdToViewType(tileId)] ?? tileId;
}

interface MosaicSplitViewProps {
  mosaicLayout: MosaicLayoutNode;
  renderView: (tileId: MosaicTileId, slot: string) => ReactNode;
  agentTitles?: Partial<Record<MosaicTileId, string>>;
  onCloseTile?: (tileId: MosaicTileId) => void;
}

export function MosaicSplitView({
  mosaicLayout,
  renderView,
  agentTitles,
  onCloseTile,
}: MosaicSplitViewProps) {
  // Ephemeral: the tile expanded over the split via CSS (see `.has-maximized`).
  // The store layout and every pane stay mounted, so minimizing just clears this
  // and the split reappears with all panes' local state intact.
  const [maximizedTile, setMaximizedTile] = useState<MosaicTileId | null>(null);

  const handleMosaicChange = useCallback((newNode: Parameters<typeof libraryToMosaicLayout>[0]) => {
    const layout = libraryToMosaicLayout(newNode);
    useUIStore.getState().setMosaicLayout(layout);
  }, []);

  const handleCloseTile = useCallback(
    (tileId: MosaicTileId) => {
      if (onCloseTile) onCloseTile(tileId);
      else useUIStore.getState().removeTileFromMosaic(tileId);
    },
    [onCloseTile],
  );

  const leaves = useMemo(() => getLeaves(mosaicLayout), [mosaicLayout]);

  // Drop the maximized tile once its pane is gone (closed/collapsed) so the
  // split renders normally again.
  if (maximizedTile && !leaves.includes(maximizedTile)) {
    setMaximizedTile(null);
  }

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
              title={getTileLabel(tileId, agentTitles ?? {})}
              toolbarControls={
                <div className="flex items-center gap-0.5 pr-0.5">
                  {leaves.length > 1 && (
                    <>
                      <Button
                        variant="unstyled"
                        onClick={() =>
                          setMaximizedTile((current) => (current === tileId ? null : tileId))
                        }
                        className={TOOLBAR_BUTTON_CLASS}
                        title={maximizedTile === tileId ? 'Restore split' : 'Maximize'}
                      >
                        {maximizedTile === tileId ? (
                          <Minimize2 className="h-3 w-3" />
                        ) : (
                          <Maximize2 className="h-3 w-3" />
                        )}
                      </Button>
                      {!maximizedTile && (
                        <Button
                          variant="unstyled"
                          onClick={() => handleCloseTile(tileId)}
                          className={TOOLBAR_BUTTON_CLASS}
                          title="Close tile"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              }
              renderToolbar={(props) => (
                <div
                  className={cn(
                    // w-full so it fills the wrapping .mosaic-window-toolbar —
                    // otherwise the div shrinks to content and justify-between
                    // can't push the controls to the right edge.
                    'flex h-7 w-full items-center justify-between px-2',
                    'bg-surface-secondary dark:bg-surface-dark-secondary',
                    'border-b border-border/50 dark:border-border-dark/50',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <SplitSquareHorizontal className="h-3 w-3 text-text-quaternary dark:text-text-dark-quaternary" />
                    <span className="text-2xs font-medium text-text-secondary dark:text-text-dark-secondary">
                      {props.title}
                    </span>
                  </div>
                  <div className="flex items-center">{props.toolbarControls}</div>
                </div>
              )}
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
