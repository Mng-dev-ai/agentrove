import type { LucideIcon } from 'lucide-react';
import { Bot, CodeXml, GitBranch, Terminal } from 'lucide-react';
import type { AgentTileId, SplitSlot, SplitTileId, TileId, ViewType } from '@/types/ui.types';

export const VIEW_LABELS: Record<ViewType, string> = {
  agent: 'Agent',
  diff: 'Diff',
  editor: 'Editor',
  terminal: 'Terminal',
};

// Canonical view → icon map; shared by the pane tabs and the view switcher so the
// glyph for a kind (diff, terminal…) stays identical in both places.
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

// A split pane is the action target only when it's both focused and bound to a
// chat — otherwise everything resolves to the primary pane.
export function activeSplitSlot(
  activeAgentTile: AgentTileId,
  splitChatIds: string[],
): SplitSlot | null {
  const slot = splitSlotOfTile(activeAgentTile);
  return slot && splitChatIds[slot - 1] ? slot : null;
}

// Maps a stored tile id back to its ViewType for label/render lookups.
// Both pane suffixes ('agent:primary', '<view>:split-N') strip to the view.
export function tileIdToViewType(tileId: TileId): ViewType {
  const colon = tileId.indexOf(':');
  return (colon === -1 ? tileId : tileId.slice(0, colon)) as ViewType;
}

// Maps a ViewType to its canonical primary tile id. The agent slot is special:
// "the agent view" always means agent:primary; split agents are only created
// by the split-chat affordance.
function viewTypeToPrimaryTile(view: ViewType): TileId {
  return view === 'agent' ? 'agent:primary' : view;
}

// Maps a (view, pane) pair to its tile id. Agent always maps to the primary slot;
// split agent tiles are created only by the split-chat affordance.
export function viewTypeToTileId(view: ViewType, slot: SplitSlot | null): TileId {
  if (slot && view !== 'agent') return `${view}:split-${slot}`;
  return viewTypeToPrimaryTile(view);
}

// Deduped view kinds for a set of tiles, preserving order. Two agent panes
// collapse to a single 'agent' entry.
export function tileViewKinds(tiles: TileId[]): ViewType[] {
  return Array.from(new Set(tiles.map(tileIdToViewType)));
}
