import { describe, it, expect } from 'vitest';
import {
  isSecondaryPaneActive,
  isSecondaryTile,
  tileIdToViewType,
  viewTypeToTileId,
  tileViewKinds,
  VIEW_LABELS,
  VIEW_ICONS,
} from './tileHelpers';
import type { ViewType } from '@/types/ui.types';

const ALL_VIEWS: ViewType[] = ['agent', 'diff', 'editor', 'terminal'];

describe('isSecondaryPaneActive', () => {
  it('is active only when the secondary agent pane is focused and bound to a chat', () => {
    expect(isSecondaryPaneActive('agent:secondary', 'chat-1')).toBe(true);
  });

  it('is inactive without a bound secondary chat', () => {
    expect(isSecondaryPaneActive('agent:secondary', null)).toBe(false);
  });

  it('is inactive when the primary agent pane is focused', () => {
    expect(isSecondaryPaneActive('agent:primary', 'chat-1')).toBe(false);
  });
});

describe('isSecondaryTile', () => {
  it('matches any tile with the :secondary suffix', () => {
    expect(isSecondaryTile('agent:secondary')).toBe(true);
    expect(isSecondaryTile('diff:secondary')).toBe(true);
  });

  it('rejects primary and bare view tiles', () => {
    expect(isSecondaryTile('agent:primary')).toBe(false);
    expect(isSecondaryTile('diff')).toBe(false);
  });
});

describe('tileIdToViewType', () => {
  it('strips the primary agent suffix back to the view kind', () => {
    expect(tileIdToViewType('agent:primary')).toBe('agent');
    expect(tileIdToViewType('agent:secondary')).toBe('agent');
  });

  it('strips a :secondary suffix off non-agent tiles', () => {
    expect(tileIdToViewType('diff:secondary')).toBe('diff');
    expect(tileIdToViewType('terminal:secondary')).toBe('terminal');
  });

  it('returns a bare primary tile unchanged', () => {
    expect(tileIdToViewType('editor')).toBe('editor');
  });
});

describe('viewTypeToTileId', () => {
  it('maps the agent view to agent:primary regardless of the secondary flag', () => {
    expect(viewTypeToTileId('agent', false)).toBe('agent:primary');
    expect(viewTypeToTileId('agent', true)).toBe('agent:primary');
  });

  it('maps a non-agent primary view to its bare tile id', () => {
    expect(viewTypeToTileId('diff', false)).toBe('diff');
  });

  it('maps a non-agent secondary view to the :secondary tile id', () => {
    expect(viewTypeToTileId('terminal', true)).toBe('terminal:secondary');
  });
});

describe('tileViewKinds', () => {
  it('collapses the two agent panes into a single agent kind, preserving order', () => {
    expect(tileViewKinds(['agent:primary', 'agent:secondary', 'diff'])).toEqual(['agent', 'diff']);
  });

  it('dedupes a primary and secondary of the same non-agent view', () => {
    expect(tileViewKinds(['diff', 'diff:secondary'])).toEqual(['diff']);
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
