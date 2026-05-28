import { useCallback, useMemo, ReactNode } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import { X, SplitSquareHorizontal } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { cn } from '@/utils/cn';
import {
  mosaicLayoutToLibrary,
  libraryToMosaicLayout,
  getLeaves,
  tileIdToViewType,
} from '@/utils/mosaicHelpers';
import type { ViewType, MosaicLayoutNode, MosaicTileId } from '@/types/ui.types';

import 'react-mosaic-component/react-mosaic-component.css';
import '@/styles/mosaic-theme.css';

const VIEW_LABELS: Record<ViewType, string> = {
  agent: 'Agent',
  diff: 'Diff',
  editor: 'Editor',
  terminal: 'Terminal',
  secrets: 'Secrets',
};

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
  const libraryValue = useMemo(() => mosaicLayoutToLibrary(mosaicLayout), [mosaicLayout]);

  return (
    <div className="mosaic-agentrove flex h-full flex-1 overflow-hidden">
      <Mosaic<string>
        value={libraryValue}
        onChange={handleMosaicChange}
        className=""
        renderTile={(id, path) => {
          const tileId = id as MosaicTileId;
          return (
            <MosaicWindow<string>
              path={path}
              title={getTileLabel(tileId, agentTitles ?? {})}
              toolbarControls={
                <div className="flex items-center gap-0.5 pr-0.5">
                  {leaves.length > 1 && (
                    <Button
                      variant="unstyled"
                      onClick={() => handleCloseTile(tileId)}
                      className={cn(
                        'flex items-center justify-center',
                        'h-5 w-5 rounded-md',
                        'text-text-tertiary dark:text-text-dark-tertiary',
                        'hover:text-text-primary dark:hover:text-text-dark-primary',
                        'transition-colors duration-200',
                      )}
                      title="Close tile"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              }
              renderToolbar={(props) => (
                <div
                  className={cn(
                    'flex h-7 items-center justify-between px-2',
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
