import { memo, useMemo, ReactNode } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { WorkspaceSplit } from '@/components/ui/WorkspaceSplit';
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

  // Mobile shows exactly one pane regardless of the stored layout — collapse a
  // multi-pane split (e.g. carried over from a desktop session that resized down)
  // to the focused tile, falling back to the first visible one. Render-only, so
  // the split returns intact when the viewport grows back. The store also owns
  // mobile semantics (uiStore.toggleView accumulates tabs differently on mobile);
  // this collapse only governs what's painted.
  const layout = useMemo(() => {
    if (!isMobile) return visibleLayout;
    const flat = visibleLayout.flat();
    const tile = focusedTile && flat.includes(focusedTile) ? focusedTile : flat[0];
    return [[tile]];
  }, [isMobile, visibleLayout, focusedTile]);

  return <WorkspaceSplit openTabs={openTabs} visibleLayout={layout} renderView={renderView} />;
});
