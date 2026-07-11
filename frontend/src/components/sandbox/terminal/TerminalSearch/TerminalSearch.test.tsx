// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { ISearchResultChangeEvent, SearchAddon } from '@xterm/addon-search';

import { TerminalSearch } from './TerminalSearch';

// Deterministic non-mac so tests drive the Ctrl+F path regardless of host OS
vi.mock('@/utils/platform', () => ({ IS_MAC_PLATFORM: false }));

type KeyHandler = (event: KeyboardEvent) => boolean;

const mocks = vi.hoisted(() => ({
  keyHandler: null as KeyHandler | null,
  resultsListener: null as ((event: ISearchResultChangeEvent) => void) | null,
}));

const terminal = {
  attachCustomKeyEventHandler: vi.fn((handler: KeyHandler) => {
    mocks.keyHandler = handler;
  }),
  focus: vi.fn(),
};

const searchAddon = {
  findNext: vi.fn(() => true),
  findPrevious: vi.fn(() => true),
  clearDecorations: vi.fn(),
  onDidChangeResults: vi.fn((listener: (event: ISearchResultChangeEvent) => void) => {
    mocks.resultsListener = listener;
    return { dispose: vi.fn() };
  }),
};

function keyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    type: 'keydown',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    code: '',
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

function renderSearch() {
  return render(
    <TerminalSearch
      isReady
      palette="dark"
      searchAddonRef={{ current: searchAddon as unknown as SearchAddon }}
      terminalRef={{ current: terminal as unknown as XTerm }}
    />,
  );
}

function openSearch(): HTMLElement {
  act(() => {
    mocks.keyHandler?.(keyEvent({ ctrlKey: true, code: 'KeyF' }));
  });
  return screen.getByRole('searchbox');
}

describe('TerminalSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.keyHandler = null;
    mocks.resultsListener = null;
  });

  // No vitest globals in this repo, so RTL's automatic cleanup never registers
  afterEach(cleanup);

  it('opens on Ctrl+F, swallows the chord, and passes other keys to the PTY', () => {
    renderSearch();
    expect(screen.queryByRole('searchbox')).toBeNull();

    const event = keyEvent({ ctrlKey: true, code: 'KeyF' });
    let handled = true;
    act(() => {
      handled = mocks.keyHandler?.(event) ?? true;
    });
    // false keeps xterm from writing ^F to the shell; preventDefault blocks
    // the browser's native find
    expect(handled).toBe(false);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));

    expect(mocks.keyHandler?.(keyEvent({ ctrlKey: true, code: 'KeyC' }))).toBe(true);
    expect(mocks.keyHandler?.(keyEvent({ code: 'KeyF' }))).toBe(true);
  });

  it('searches incrementally as the query changes', () => {
    renderSearch();
    const input = openSearch();

    fireEvent.change(input, { target: { value: 'error' } });
    expect(searchAddon.findNext).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ incremental: true, decorations: expect.anything() }),
    );

    // Clearing the query drops the highlights and the stale count
    fireEvent.change(input, { target: { value: '' } });
    expect(searchAddon.clearDecorations).toHaveBeenCalled();
  });

  it('steps matches with Enter / Shift+Enter', () => {
    renderSearch();
    const input = openSearch();
    fireEvent.change(input, { target: { value: 'error' } });
    searchAddon.findNext.mockClear();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(searchAddon.findNext).toHaveBeenCalledWith(
      'error',
      expect.not.objectContaining({ incremental: true }),
    );

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(searchAddon.findPrevious).toHaveBeenCalledWith('error', expect.anything());
  });

  it('shows the active match count reported by the addon', () => {
    renderSearch();
    const input = openSearch();
    fireEvent.change(input, { target: { value: 'error' } });

    act(() => {
      mocks.resultsListener?.({ resultIndex: 2, resultCount: 10 });
    });
    expect(screen.getByText('3/10')).toBeTruthy();

    act(() => {
      mocks.resultsListener?.({ resultIndex: -1, resultCount: 0 });
    });
    expect(screen.getByText('0/0')).toBeTruthy();
  });

  it('Escape closes the bar, clears highlights, and refocuses the terminal', () => {
    renderSearch();
    const input = openSearch();
    fireEvent.change(input, { target: { value: 'error' } });

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(searchAddon.clearDecorations).toHaveBeenCalled();
    expect(terminal.focus).toHaveBeenCalled();
  });
});
