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

export function splitAgentTile(slot: SplitSlot): AgentTileId {
  return `agent:split-${slot}`;
}

export function agentTileFor(tileId: TileId): AgentTileId {
  const slot = splitSlotOfTile(tileId);
  return slot ? splitAgentTile(slot) : 'agent:primary';
}

// Split tiles bind their slot's chat; every other tile binds the route chat.
export function tileChatId(
  tileId: TileId,
  splitChatIds: string[],
  routeChatId: string | undefined,
): string | undefined {
  const slot = splitSlotOfTile(tileId);
  return slot ? splitChatIds[slot - 1] : routeChatId;
}

// Split tiles key by their chat so a slot renumber keeps the pane mounted.
export function tileRenderKey(tileId: TileId, splitChatIds: string[]): string {
  const slot = splitSlotOfTile(tileId);
  const chatId = slot && splitChatIds[slot - 1];
  return chatId ? `${tileIdToViewType(tileId)}:${chatId}` : tileId;
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

// Mobile paints one pane (focused, else first); desktop paints the whole layout.
export function paintedLayout(
  visibleLayout: TileId[][],
  focusedTile: TileId | null,
  isMobile: boolean,
): TileId[][] {
  if (!isMobile) return visibleLayout;
  const flat = visibleLayout.flat();
  const tile = focusedTile && flat.includes(focusedTile) ? focusedTile : flat[0];
  return tile ? [[tile]] : [];
}

export function paintedChatIds(
  tiles: TileId[],
  splitChatIds: string[],
  routeChatId: string | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const tile of tiles) {
    const chatId = tileChatId(tile, splitChatIds, routeChatId);
    if (chatId) ids.add(chatId);
  }
  return ids;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

// A pane's panel and view switcher sit at the right of its rightmost tile in the agent's row.
export function panelHostTile(layout: TileId[][], agentTile: AgentTileId): TileId | undefined {
  const inGroup = (tile: TileId) => agentTileFor(tile) === agentTile;
  const row = layout.find((r) => r.includes(agentTile)) ?? layout.find((r) => r.some(inGroup));
  const group = row?.filter(inGroup) ?? [];
  return group[group.length - 1];
}

export function sessionPanelHosts(layout: TileId[][], openAgentTiles: AgentTileId[]): Set<TileId> {
  const hosts = new Set<TileId>();
  for (const agentTile of openAgentTiles) {
    const host = panelHostTile(layout, agentTile);
    if (host) hosts.add(host);
  }
  return hosts;
}

export interface TileColumns {
  template: string;
  columnOf: Map<TileId, string>;
}

// Rows split the width evenly; an open panel adds a fixed track after its host, and every
// tile ending at that boundary spans it so no row leaves a gap.
export function tileColumns(layout: TileId[][], panelHosts: Set<TileId>): TileColumns {
  const cols = layout.reduce((acc, row) => lcm(acc, row.length), 1);
  const panelAfter = new Set<number>();
  for (const row of layout) {
    row.forEach((tile, c) => {
      if (panelHosts.has(tile)) panelAfter.add((c + 1) * (cols / row.length));
    });
  }
  const tracks: string[] = [];
  const trackStart: number[] = [];
  const trackEnd: number[] = [];
  for (let col = 1; col <= cols; col++) {
    trackStart[col] = tracks.length + 1;
    tracks.push('minmax(0, 1fr)');
    if (panelAfter.has(col)) tracks.push('var(--session-panel-width)');
    trackEnd[col] = tracks.length + 1;
  }
  const columnOf = new Map<TileId, string>();
  for (const row of layout) {
    const span = cols / row.length;
    row.forEach((tile, c) => {
      columnOf.set(tile, `${trackStart[c * span + 1]} / ${trackEnd[(c + 1) * span]}`);
    });
  }
  return { template: tracks.join(' '), columnOf };
}
