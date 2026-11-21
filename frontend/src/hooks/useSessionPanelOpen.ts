import { isSessionPanelOpen, useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { AgentTileId } from '@/types/ui.types';

export function useSessionPanelOpen(agentTile: AgentTileId): boolean {
  const isMobile = useIsMobile();
  return useUIStore((s) =>
    isMobile ? s.mobileSessionPanelOpen : isSessionPanelOpen(s, agentTile),
  );
}

// With split chats open, each agent pane draws its own panel; otherwise one panel sits beside the workspace.
export function useSessionPanelsInPanes(): boolean {
  const isMobile = useIsMobile();
  return useUIStore((s) => !isMobile && s.splitChatIds.length > 0);
}
