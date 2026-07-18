import { describe, it, expect } from 'vitest';
import {
  activeSplitSlot,
  isSplitTile,
  splitSlotOfTile,
  tileIdToViewType,
  viewTypeToTileId,
  tileViewKinds,
  VIEW_LABELS,
  VIEW_ICONS,
} from './tileHelpers';
import type { ViewType } from '@/types/ui.types';

const ALL_VIEWS: ViewType[] = ['agent', 'diff', 'editor', 'terminal'];

describe('activeSplitSlot', () => {
  it('returns the focused split slot when it is bound to a chat', () => {
    expect(activeSplitSlot('agent:split-2', ['chat-1', 'chat-2'])).toBe(2);
  });

  it('returns primary when the focused split slot is unbound', () => {
    expect(activeSplitSlot('agent:split-2', ['chat-1'])).toBeNull();
  });

  it('returns primary when the primary agent pane is focused', () => {
    expect(activeSplitSlot('agent:primary', ['chat-1'])).toBeNull();
  });
});

describe('splitSlotOfTile / isSplitTile', () => {
  it('parses every supported split suffix', () => {
    expect(splitSlotOfTile('agent:split-1')).toBe(1);
    expect(splitSlotOfTile('diff:split-2')).toBe(2);
    expect(splitSlotOfTile('terminal:split-3')).toBe(3);
    expect(isSplitTile('diff:split-2')).toBe(true);
  });

  it('rejects primary and bare view tiles', () => {
    expect(splitSlotOfTile('agent:primary')).toBeNull();
    expect(splitSlotOfTile('diff')).toBeNull();
    expect(isSplitTile('diff')).toBe(false);
  });
});

describe('tileIdToViewType', () => {
  it('strips agent and split suffixes back to the view kind', () => {
    expect(tileIdToViewType('agent:primary')).toBe('agent');
    expect(tileIdToViewType('agent:split-3')).toBe('agent');
    expect(tileIdToViewType('diff:split-2')).toBe('diff');
    expect(tileIdToViewType('terminal:split-1')).toBe('terminal');
  });

  it('returns a bare primary tile unchanged', () => {
    expect(tileIdToViewType('editor')).toBe('editor');
  });
});

describe('viewTypeToTileId', () => {
  it('maps the agent view to agent:primary regardless of the split slot', () => {
    expect(viewTypeToTileId('agent', null)).toBe('agent:primary');
    expect(viewTypeToTileId('agent', 3)).toBe('agent:primary');
  });

  it('maps primary and split non-agent views', () => {
    expect(viewTypeToTileId('diff', null)).toBe('diff');
    expect(viewTypeToTileId('terminal', 2)).toBe('terminal:split-2');
  });
});

describe('tileViewKinds', () => {
  it('dedupes pane variants while preserving order', () => {
    expect(tileViewKinds(['agent:primary', 'agent:split-1', 'diff', 'diff:split-2'])).toEqual([
      'agent',
      'diff',
    ]);
  });

  it('returns an empty array for no tiles', () => {
    expect(tileViewKinds([])).toEqual([]);
  });
});

describe('VIEW_LABELS / VIEW_ICONS', () => {
  it('define a label and an icon for every view kind', () => {
    for (const view of ALL_VIEWS) {
      expect(VIEW_LABELS[view]).toBeTruthy();
      expect(VIEW_ICONS[view]).toBeTruthy();
    }
  });
});
