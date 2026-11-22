import { createContext } from 'react';
import type { AgentTileId } from '@/types/ui.types';

interface SessionPanelSlots {
  slots: Partial<Record<AgentTileId, HTMLElement>>;
  // Returns the ref cleanup that unregisters the element.
  register: (agentTile: AgentTileId, el: HTMLElement) => () => void;
}

export const SessionPanelSlotContext = createContext<SessionPanelSlots | null>(null);
