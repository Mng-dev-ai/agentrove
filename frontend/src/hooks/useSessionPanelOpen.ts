import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { openSessionPanelTiles, sessionPanelOpenFor, useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { sessionPanelHosts } from '@/utils/tileHelpers';
import type { AgentTileId, TileId } from '@/types/ui.types';

export function useSessionPanelOpen(agentTile: AgentTileId): boolean {
  const isMobile = useIsMobile();
  return useUIStore((s) =>
    isMobile ? s.mobileSessionPanelOpen : sessionPanelOpenFor(s, agentTile),
  );
}

// Phones show the panel in place of the workspace, so it never takes a grid track.
export function useSessionPanelHosts(layout: TileId[][]): Set<TileId> {
  const isMobile = useIsMobile();
  const openAgentTiles = useUIStore(useShallow(openSessionPanelTiles));
  return useMemo(
    () => (isMobile ? new Set<TileId>() : sessionPanelHosts(layout, openAgentTiles)),
    [isMobile, layout, openAgentTiles],
  );
}
