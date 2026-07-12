// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useUIStore,
  clampSidebarWidth,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
} from './uiStore';
import { THEME_CYCLE } from '@/utils/theme';

const state = () => useUIStore.getState();

// jsdom's default innerWidth (1024) is above MOBILE_BREAKPOINT, so isDesktop()
// is true here — the split/layout paths take their desktop branches.
beforeEach(() => {
  localStorage.clear();
  useUIStore.setState({
    theme: 'dark',
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    openTabs: ['agent:primary'],
    visibleLayout: [['agent:primary']],
    secondaryChatId: null,
    activeAgentTile: 'agent:primary',
    focusedTile: null,
    layoutsByChat: {},
    editorByChat: {},
    currentWorkspaceChatId: null,
    chatTabs: [],
    pendingFileOpen: null,
    composerSelectionsByChat: {},
  });
});

describe('clampSidebarWidth', () => {
  it('clamps below the minimum and above the maximum', () => {
    expect(clampSidebarWidth(0)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(9999)).toBe(MAX_SIDEBAR_WIDTH);
  });

  it('rounds fractional widths within range', () => {
    expect(clampSidebarWidth(300.6)).toBe(301);
  });
});

describe('setSidebarWidth', () => {
  it('stores the clamped width', () => {
    state().setSidebarWidth(10_000);
    expect(state().sidebarWidth).toBe(MAX_SIDEBAR_WIDTH);
  });

  it('is a no-op (stable reference) when the clamped width is unchanged', () => {
    state().setSidebarWidth(MAX_SIDEBAR_WIDTH);
    const before = state();
    // A larger value clamps back to the same MAX — the guard must skip the set.
    state().setSidebarWidth(MAX_SIDEBAR_WIDTH + 50);
    expect(useUIStore.getState()).toBe(before);
  });
});

describe('theme', () => {
  it('cycles to the next theme and wraps around', () => {
    useUIStore.setState({ theme: THEME_CYCLE[THEME_CYCLE.length - 1] });
    state().toggleTheme();
    expect(state().theme).toBe(THEME_CYCLE[0]);
  });

  it('setTheme jumps directly to a theme', () => {
    state().setTheme('nord');
    expect(state().theme).toBe('nord');
  });
});

describe('composer selections', () => {
  const chatSel = (text: string) => ({ kind: 'chat' as const, text });

  it('appends selections per chat, keeping order', () => {
    state().addComposerSelection('c1', chatSel('a'));
    state().addComposerSelection('c1', chatSel('b'));
    expect(state().composerSelectionsByChat.c1.map((s) => 'text' in s && s.text)).toEqual([
      'a',
      'b',
    ]);
  });

  it('removes a selection by index', () => {
    state().addComposerSelection('c1', chatSel('a'));
    state().addComposerSelection('c1', chatSel('b'));
    state().removeComposerSelection('c1', 0);
    expect(state().composerSelectionsByChat.c1).toEqual([chatSel('b')]);
  });

  it('clears a chat bucket to an empty array', () => {
    state().addComposerSelection('c1', chatSel('a'));
    state().clearComposerSelections('c1');
    expect(state().composerSelectionsByChat.c1).toEqual([]);
  });

  it('keeps selections isolated per chat', () => {
    state().addComposerSelection('c1', chatSel('a'));
    state().addComposerSelection('c2', chatSel('z'));
    expect(state().composerSelectionsByChat.c1).toEqual([chatSel('a')]);
    expect(state().composerSelectionsByChat.c2).toEqual([chatSel('z')]);
  });
});

describe('chatTabs', () => {
  it('opens a tab once, ignoring duplicates', () => {
    state().openChatTab('c1');
    const before = state();
    state().openChatTab('c1');
    // Idempotent — a second open must not re-write the array.
    expect(useUIStore.getState()).toBe(before);
    expect(state().chatTabs).toEqual(['c1']);
  });

  it('closes an open tab and no-ops an unknown one', () => {
    state().openChatTab('c1');
    state().closeChatTab('c1');
    expect(state().chatTabs).toEqual([]);
    const before = state();
    state().closeChatTab('missing');
    expect(useUIStore.getState()).toBe(before);
  });
});

describe('openFileInEditor', () => {
  it('records the pending open, adds the editor tab, and bumps the nonce on re-open', () => {
    state().openFileInEditor('a.ts', 'c1', 12);
    expect(state().pendingFileOpen).toMatchObject({
      path: 'a.ts',
      chatId: 'c1',
      line: 12,
      nonce: 1,
    });
    expect(state().openTabs).toContain('editor');

    state().openFileInEditor('a.ts', 'c1', 12);
    // Same path/line re-opens must still register (nonce increments) so the
    // editor re-focuses after the user scrolled away.
    expect(state().pendingFileOpen?.nonce).toBe(2);
  });

  it('omits the line field when none is given', () => {
    state().openFileInEditor('a.ts', 'c1');
    expect(state().pendingFileOpen).not.toHaveProperty('line');
  });
});

describe('loadWorkspaceForChat', () => {
  it('adds the chat tab and defaults to a lone agent view on first visit', () => {
    state().loadWorkspaceForChat('c1');
    expect(state().currentWorkspaceChatId).toBe('c1');
    expect(state().chatTabs).toContain('c1');
    expect(state().visibleLayout).toEqual([['agent:primary']]);
  });

  it('stashes the outgoing chat layout and restores it on return', () => {
    state().loadWorkspaceForChat('c1');
    // Open the editor view for c1 so its layout is non-default.
    state().toggleView('editor', false);
    expect(state().visibleLayout.flat()).toContain('editor');

    state().loadWorkspaceForChat('c2');
    // c2 starts fresh...
    expect(state().visibleLayout).toEqual([['agent:primary']]);

    state().loadWorkspaceForChat('c1');
    // ...and c1's stashed editor layout comes back.
    expect(state().visibleLayout.flat()).toContain('editor');
  });
});

describe('cleanupChat', () => {
  it('drops the chat tab, saved layout, and clears the live pointer when it is current', () => {
    state().loadWorkspaceForChat('c1');
    state().toggleView('editor', false);
    state().cleanupChat('c1');

    expect(state().chatTabs).not.toContain('c1');
    expect('c1' in state().layoutsByChat).toBe(false);
    expect(state().currentWorkspaceChatId).toBeNull();
  });
});

describe('cleanupAllChats', () => {
  it('resets the workspace and wipes all per-chat maps', () => {
    state().loadWorkspaceForChat('c1');
    state().toggleView('editor', false);
    state().cleanupAllChats();

    expect(state().chatTabs).toEqual([]);
    expect(state().layoutsByChat).toEqual({});
    expect(state().editorByChat).toEqual({});
    expect(state().visibleLayout).toEqual([['agent:primary']]);
    expect(state().currentWorkspaceChatId).toBeNull();
  });
});

describe('split chat', () => {
  it('opens a secondary chat side by side and tears it down on close', () => {
    state().openChatInSplit('c2');
    expect(state().secondaryChatId).toBe('c2');
    expect(state().visibleLayout).toEqual([['agent:primary', 'agent:secondary']]);
    expect(state().chatTabs).toContain('c2');

    state().closeSplitChat();
    expect(state().secondaryChatId).toBeNull();
    expect(state().openTabs).not.toContain('agent:secondary');
    expect(state().visibleLayout).toEqual([['agent:primary']]);
    expect(state().activeAgentTile).toBe('agent:primary');
  });

  it('drops a pending jump aimed at the replaced secondary chat', () => {
    state().openChatInSplit('c2');
    // A jump bound to c2 (the secondary) becomes stale once c2 leaves the split.
    state().openFileInEditor('a.ts', 'c2');
    state().closeSplitChat();
    expect(state().pendingFileOpen).toBeNull();
  });
});

describe('removeTab', () => {
  it('never closes the base agent tab', () => {
    const before = state();
    state().removeTab('agent:primary');
    expect(useUIStore.getState()).toBe(before);
  });

  it('closes a view and lands focus back on an agent pane', () => {
    state().toggleView('editor', false);
    expect(state().visibleLayout.flat()).toContain('editor');
    state().removeTab('editor');
    expect(state().openTabs).not.toContain('editor');
    expect(state().visibleLayout).toEqual([['agent:primary']]);
  });
});

describe('resetWorkspace', () => {
  it('collapses to a single agent view and detaches from the chat', () => {
    state().openChatInSplit('c2');
    state().loadWorkspaceForChat('c1');
    state().resetWorkspace();
    expect(state().visibleLayout).toEqual([['agent:primary']]);
    expect(state().secondaryChatId).toBeNull();
    expect(state().currentWorkspaceChatId).toBeNull();
    expect(state().focusedTile).toBeNull();
  });
});
