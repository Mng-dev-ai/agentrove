import type { MosaicLayoutNode, MosaicSplitNode, MosaicTileId, ViewType } from '@/types/ui.types';
import type { MosaicNode } from 'react-mosaic-component';

export function isMosaicSplitNode(node: MosaicLayoutNode): node is MosaicSplitNode {
  return typeof node === 'object' && 'direction' in node;
}

export function getLeaves(node: MosaicLayoutNode): MosaicTileId[] {
  if (typeof node === 'string') return [node as MosaicTileId];
  return [...getLeaves(node.first), ...getLeaves(node.second)];
}

// Maps a stored mosaic tile id back to its ViewType for label/render lookups.
export function tileIdToViewType(tileId: MosaicTileId): ViewType {
  if (tileId === 'agent:primary' || tileId === 'agent:secondary') return 'agent';
  return tileId;
}

// Maps a ViewType to its canonical primary tile id. The agent slot is special:
// "the agent view" always means agent:primary; agent:secondary is only created
// by the split-chat affordance.
export function viewTypeToPrimaryTile(view: ViewType): MosaicTileId {
  return view === 'agent' ? 'agent:primary' : view;
}

// Returns the leaves' view types, deduped, preserving order. Two agent panes
// (primary + secondary) collapse to a single 'agent' entry.
export function getLeafViewTypes(node: MosaicLayoutNode): ViewType[] {
  return Array.from(new Set(getLeaves(node).map(tileIdToViewType)));
}

// Converts our internal binary-tree layout to the react-mosaic n-ary format.
// Flattens consecutive splits in the same direction into a single children
// array with proportional percentages so the library renders correct sizes.
export function mosaicLayoutToLibrary(node: MosaicLayoutNode): MosaicNode<string> {
  if (typeof node === 'string') return node;

  const children: MosaicNode<string>[] = [];
  const percentages: number[] = [];
  flattenSameDirection(node, node.direction, 100, children, percentages);

  const hasValidPercentages = percentages.length === children.length;
  return {
    type: 'split' as const,
    direction: node.direction,
    children,
    splitPercentages: hasValidPercentages ? percentages : undefined,
  };
}

function flattenSameDirection(
  node: MosaicLayoutNode,
  direction: string,
  scalePct: number,
  out: MosaicNode<string>[],
  pcts: number[],
): void {
  if (typeof node === 'string') {
    out.push(node);
    pcts.push(scalePct);
    return;
  }
  if (node.direction !== direction) {
    out.push(mosaicLayoutToLibrary(node));
    pcts.push(scalePct);
    return;
  }
  const firstRatio = node.splitPercentages ? node.splitPercentages[0] / 100 : 0.5;
  const secondRatio = 1 - firstRatio;
  flattenSameDirection(node.first, direction, scalePct * firstRatio, out, pcts);
  flattenSameDirection(node.second, direction, scalePct * secondRatio, out, pcts);
}

// Converts react-mosaic's n-ary/legacy/tabs format back to our internal
// binary-tree model. Handles three incoming shapes: n-ary splits (right-folded
// into binary pairs), legacy binary splits, and tab groups (flattened to the
// active tab since our model doesn't support tabs).
export function libraryToMosaicLayout(node: MosaicNode<string> | null): MosaicLayoutNode | null {
  if (node === null) return null;
  if (typeof node === 'string') return node as MosaicTileId;
  if (typeof node === 'number') return String(node) as MosaicTileId;

  // Handle tabs node: flatten to the active tab (our internal model doesn't support tabs)
  if ('type' in node && node.type === 'tabs' && 'tabs' in node) {
    const tabs = node as { type: 'tabs'; tabs: MosaicNode<string>[]; activeTabIndex: number };
    if (tabs.tabs.length === 0) return null;
    const activeIndex = Math.min(tabs.activeTabIndex ?? 0, tabs.tabs.length - 1);
    return libraryToMosaicLayout(tabs.tabs[activeIndex]);
  }

  // Handle n-ary format: { type: 'split', direction, children, splitPercentages }
  if ('type' in node && node.type === 'split' && 'children' in node) {
    const nary = node as {
      type: 'split';
      direction: 'row' | 'column';
      children: MosaicNode<string>[];
      splitPercentages?: number[];
    };
    if (nary.children.length === 0) return null;
    if (nary.children.length === 1) return libraryToMosaicLayout(nary.children[0]);

    // Convert n-ary to binary by right-folding: [a, b, c] => { first: a, second: { first: b, second: c } }
    // Percentages are scaled to be relative to each binary subtree
    let result = libraryToMosaicLayout(nary.children[nary.children.length - 1])!;
    let remainingPct = nary.splitPercentages?.[nary.children.length - 1] ?? 0;
    for (let i = nary.children.length - 2; i >= 0; i--) {
      const pcts = nary.splitPercentages;
      if (pcts) {
        const subtotalPct = pcts[i] + remainingPct;
        const firstRelative = subtotalPct > 0 ? (pcts[i] / subtotalPct) * 100 : 50;
        result = {
          direction: nary.direction,
          first: libraryToMosaicLayout(nary.children[i])!,
          second: result,
          splitPercentages: [firstRelative, 100 - firstRelative],
        };
        remainingPct = subtotalPct;
      } else {
        result = {
          direction: nary.direction,
          first: libraryToMosaicLayout(nary.children[i])!,
          second: result,
        };
      }
    }
    return result;
  }

  // Handle legacy binary format: { direction, first, second, splitPercentage }
  if ('direction' in node && 'first' in node && 'second' in node) {
    const legacy = node as {
      direction: 'row' | 'column';
      first: MosaicNode<string>;
      second: MosaicNode<string>;
      splitPercentage?: number;
    };
    const pct = legacy.splitPercentage;
    return {
      direction: legacy.direction,
      first: libraryToMosaicLayout(legacy.first)!,
      second: libraryToMosaicLayout(legacy.second)!,
      ...(pct != null && { splitPercentages: [pct, 100 - pct] }),
    };
  }

  return null;
}

export function removeTileFromLayout(
  layout: MosaicLayoutNode,
  tileToRemove: MosaicTileId,
): MosaicLayoutNode | null {
  if (typeof layout === 'string') {
    return layout === tileToRemove ? null : layout;
  }

  const firstResult = removeTileFromLayout(layout.first, tileToRemove);
  const secondResult = removeTileFromLayout(layout.second, tileToRemove);

  if (firstResult === null && secondResult === null) return null;
  if (firstResult === null) return secondResult;
  if (secondResult === null) return firstResult;

  return { ...layout, first: firstResult, second: secondResult };
}
