import { useShallow } from 'zustand/react/shallow';
import { openSessionPanelTiles, sessionPanelOpenFor, useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { AgentTileId } from '@/types/ui.types';

export const NO_AGENT_TILES: AgentTileId[] = [];

export function useSessionPanelOpen(agentTile: AgentTileId): boolean {
  const isMobile = useIsMobile();
  return useUIStore((s) =>
    isMobile ? s.mobileSessionPanelOpen : sessionPanelOpenFor(s, agentTile),
  );
}

// Phones show the panel in place of the workspace, so it never takes a grid track.
export function useOpenSessionPanelTiles(): AgentTileId[] {
  const isMobile = useIsMobile();
  return useUIStore(useShallow((s) => (isMobile ? NO_AGENT_TILES : openSessionPanelTiles(s))));
}
