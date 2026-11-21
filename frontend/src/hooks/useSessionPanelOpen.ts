import { useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { activeSplitSlot } from '@/utils/tileHelpers';
import type { AgentTileId } from '@/types/ui.types';

export function useSessionPanelOpen(agentTile: AgentTileId): boolean {
  const isMobile = useIsMobile();
  return useUIStore((s) => {
    if (isMobile) return s.mobileSessionPanelOpen;
    const slot = activeSplitSlot(agentTile, s.splitChatIds);
    return slot
      ? s.splitSessionPanelChatIds.includes(s.splitChatIds[slot - 1])
      : s.sessionPanelOpen;
  });
}
