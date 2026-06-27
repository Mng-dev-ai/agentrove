import type { LucideIcon } from 'lucide-react';
import { Bot, CodeXml, GitBranch, Lock, Terminal } from 'lucide-react';
import type { AgentTileId, TileId, SecondaryTileId, ViewType } from '@/types/ui.types';

export const VIEW_LABELS: Record<ViewType, string> = {
  agent: 'Agent',
  diff: 'Diff',
  editor: 'Editor',
  terminal: 'Terminal',
  secrets: 'Secrets',
};

// Canonical view → icon map; shared by the pane tabs and the view switcher so the
// glyph for a kind (diff, terminal…) stays identical in both places.
export const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  agent: Bot,
  diff: GitBranch,
  editor: CodeXml,
  terminal: Terminal,
  secrets: Lock,
};

// The secondary pane is the action target only when it's both focused and bound
// to a chat — otherwise everything resolves to the primary pane.
export function isSecondaryPaneActive(
  activeAgentTile: AgentTileId,
  secondaryChatId: string | null,
): boolean {
  return activeAgentTile === 'agent:secondary' && !!secondaryChatId;
}

export function isSecondaryTile(tileId: TileId): tileId is SecondaryTileId {
  return tileId.endsWith(':secondary');
}

// Maps a stored tile id back to its ViewType for label/render lookups.
// Both pane suffixes ('agent:primary', '<view>:secondary') strip to the view.
export function tileIdToViewType(tileId: TileId): ViewType {
  const colon = tileId.indexOf(':');
  return (colon === -1 ? tileId : tileId.slice(0, colon)) as ViewType;
}

// Maps a ViewType to its canonical primary tile id. The agent slot is special:
// "the agent view" always means agent:primary; agent:secondary is only created
// by the split-chat affordance.
function viewTypeToPrimaryTile(view: ViewType): TileId {
  return view === 'agent' ? 'agent:primary' : view;
}

// Maps a (view, pane) pair to its tile id. Agent always maps to the primary
// slot — agent:secondary is created only by the split-chat affordance.
export function viewTypeToTileId(view: ViewType, secondary: boolean): TileId {
  if (secondary && view !== 'agent') return `${view}:secondary`;
  return viewTypeToPrimaryTile(view);
}

// Deduped view kinds for a set of tiles, preserving order. Two agent panes
// (primary + secondary) collapse to a single 'agent' entry.
export function tileViewKinds(tiles: TileId[]): ViewType[] {
  return Array.from(new Set(tiles.map(tileIdToViewType)));
}
