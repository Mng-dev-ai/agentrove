import type { LucideIcon } from 'lucide-react';
import { Bot, CodeXml, GitBranch, Terminal } from 'lucide-react';
import type { AgentTileId, SplitSlot, SplitTileId, TileId, ViewType } from '@/types/ui.types';

export const VIEW_LABELS: Record<ViewType, string> = {
  agent: 'Agent',
  diff: 'Diff',
  editor: 'Editor',
  terminal: 'Terminal',
};

// Shared by pane tabs and the view switcher so glyphs stay identical.
export const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  agent: Bot,
  diff: GitBranch,
  editor: CodeXml,
  terminal: Terminal,
};

export function splitSlotOfTile(tileId: TileId): SplitSlot | null {
  const match = tileId.match(/:split-([1-3])$/);
  if (match?.[1] === '1') return 1;
  if (match?.[1] === '2') return 2;
  if (match?.[1] === '3') return 3;
  return null;
}

export function isSplitTile(tileId: TileId): tileId is SplitTileId {
  return splitSlotOfTile(tileId) !== null;
}

// Action target is a split pane only when focused and bound to a chat.
export function activeSplitSlot(
  activeAgentTile: AgentTileId,
  splitChatIds: string[],
): SplitSlot | null {
  const slot = splitSlotOfTile(activeAgentTile);
  return slot && splitChatIds[slot - 1] ? slot : null;
}

// Both 'agent:primary' and '<view>:split-N' strip to the view kind.
export function tileIdToViewType(tileId: TileId): ViewType {
  const colon = tileId.indexOf(':');
  return (colon === -1 ? tileId : tileId.slice(0, colon)) as ViewType;
}

// Agent always means agent:primary; split agents come only from split-chat.
function viewTypeToPrimaryTile(view: ViewType): TileId {
  return view === 'agent' ? 'agent:primary' : view;
}

// Agent always maps to the primary slot (split agents only via split-chat).
export function viewTypeToTileId(view: ViewType, slot: SplitSlot | null): TileId {
  if (slot && view !== 'agent') return `${view}:split-${slot}`;
  return viewTypeToPrimaryTile(view);
}

// Deduped view kinds, order-preserving (two agent panes → one 'agent').
export function tileViewKinds(tiles: TileId[]): ViewType[] {
  return Array.from(new Set(tiles.map(tileIdToViewType)));
}
