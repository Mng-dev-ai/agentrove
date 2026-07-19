import { memo, useMemo, ReactNode } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { WorkspaceSplit } from '@/components/ui/WorkspaceSplit/WorkspaceSplit';
import type { TileId } from '@/types/ui.types';

interface SplitViewContainerProps {
  renderView: (tileId: TileId, isVisible: boolean) => ReactNode;
}

export const SplitViewContainer = memo(function SplitViewContainer({
  renderView,
}: SplitViewContainerProps) {
  const openTabs = useUIStore((state) => state.openTabs);
  const visibleLayout = useUIStore((state) => state.visibleLayout);
  const focusedTile = useUIStore((state) => state.focusedTile);
  const isMobile = useIsMobile();

  // Mobile paints one pane (focused, else first). Render-only — store layout stays intact.
  const layout = useMemo(() => {
    if (!isMobile) return visibleLayout;
    const flat = visibleLayout.flat();
    const tile = focusedTile && flat.includes(focusedTile) ? focusedTile : flat[0];
    return [[tile]];
  }, [isMobile, visibleLayout, focusedTile]);

  return <WorkspaceSplit openTabs={openTabs} visibleLayout={layout} renderView={renderView} />;
});
