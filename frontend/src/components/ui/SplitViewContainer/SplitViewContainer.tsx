import { memo, useMemo, ReactNode } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { NO_AGENT_TILES, useOpenSessionPanelTiles } from '@/hooks/useSessionPanelOpen';
import { WorkspaceSplit } from '@/components/ui/WorkspaceSplit/WorkspaceSplit';
import { paintedLayout } from '@/utils/tileHelpers';
import type { TileId } from '@/types/ui.types';

interface SplitViewContainerProps {
  renderView: (tileId: TileId, isVisible: boolean) => ReactNode;
  paneSessionPanels: boolean;
}

export const SplitViewContainer = memo(function SplitViewContainer({
  renderView,
  paneSessionPanels,
}: SplitViewContainerProps) {
  const openTabs = useUIStore((state) => state.openTabs);
  const visibleLayout = useUIStore((state) => state.visibleLayout);
  const focusedTile = useUIStore((state) => state.focusedTile);
  const splitChatIds = useUIStore((state) => state.splitChatIds);
  const isMobile = useIsMobile();

  // Render-only collapse — the store layout stays intact.
  const layout = useMemo(
    () => paintedLayout(visibleLayout, focusedTile, isMobile),
    [isMobile, visibleLayout, focusedTile],
  );
  const openPanelTiles = useOpenSessionPanelTiles();

  return (
    <WorkspaceSplit
      openTabs={openTabs}
      visibleLayout={layout}
      splitChatIds={splitChatIds}
      openPanelTiles={paneSessionPanels ? openPanelTiles : NO_AGENT_TILES}
      renderView={renderView}
    />
  );
});
