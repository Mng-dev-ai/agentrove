// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useUIStore,
  clampSidebarWidth,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  migrateUIState,
} from './uiStore';
import { THEME_CYCLE } from '@/utils/theme';

const state = () => useUIStore.getState();

beforeEach(() => {
  localStorage.clear();
  useUIStore.setState({
    theme: 'dark',
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    openTabs: ['agent:primary'],
    visibleLayout: [['agent:primary']],
    splitChatIds: [],
    activeAgentTile: 'agent:primary',
    focusedTile: null,
    layoutsByChat: {},
    editorByChat: {},
    currentWorkspaceChatId: null,
    chatTabs: [],
    pendingFileOpen: null,
    fileOpenNonce: 0,
    composerSelectionsByChat: {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
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
  it('is a no-op (stable reference) when the clamped width is unchanged', () => {
    state().setSidebarWidth(MAX_SIDEBAR_WIDTH);
    const before = state();
    state().setSidebarWidth(MAX_SIDEBAR_WIDTH + 50);
    expect(useUIStore.getState()).toBe(before);
  });
});

describe('toggleTheme', () => {
  it('cycles to the next theme and wraps around', () => {
    useUIStore.setState({ theme: THEME_CYCLE[THEME_CYCLE.length - 1] });
    state().toggleTheme();
    expect(state().theme).toBe(THEME_CYCLE[0]);
  });
});

describe('composer selections', () => {
  const chatSel = (text: string) => ({ kind: 'chat' as const, text });

  it('appends in order and removes a selection by index', () => {
    state().addComposerSelection('c1', chatSel('a'));
    state().addComposerSelection('c1', chatSel('b'));
    state().removeComposerSelection('c1', 0);
    expect(state().composerSelectionsByChat.c1).toEqual([chatSel('b')]);
  });
});

describe('chatTabs', () => {
  it('opens a tab once, ignoring duplicates', () => {
    state().openChatTab('c1');
    const before = state();
    state().openChatTab('c1');
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
    expect(state().pendingFileOpen?.nonce).toBe(2);
  });

  it('keeps incrementing the nonce after a consumer clears pendingFileOpen', () => {
    state().openFileInEditor('a.ts', 'c1', 12);
    useUIStore.setState({ pendingFileOpen: null });
    state().openFileInEditor('a.ts', 'c1', 12);
    expect(state().pendingFileOpen?.nonce).toBe(2);
  });

  it('omits the line field when none is given', () => {
    state().openFileInEditor('a.ts', 'c1');
    expect(state().pendingFileOpen).not.toHaveProperty('line');
  });

  it('opens the editor tile for the chat bound to a split slot', () => {
    state().openChatInSplit('c2');
    state().openChatInSplit('c3');

    state().openFileInEditor('a.ts', 'c3');

    expect(state().openTabs).toContain('editor:split-2');
    expect(state().visibleLayout).toEqual([['editor:split-2']]);
  });

  it('opens beside the current view when split is requested, instead of replacing it', () => {
    state().openFileInEditor('a.ts', undefined, undefined, true);
    expect(state().visibleLayout).toEqual([['agent:primary', 'editor']]);
    expect(state().focusedTile).toBe('editor');
  });
});

describe('toggleView', () => {
  it('closes a visible view on toggle but resurfaces it when it is in the background', () => {
    state().toggleView('editor', true);
    expect(state().visibleLayout).toEqual([['editor']]);

    state().toggleView('editor', true);
    expect(state().openTabs).not.toContain('editor');
    expect(state().visibleLayout).toEqual([['agent:primary']]);

    state().toggleView('editor', false);
    state().activateTab('agent:primary');
    state().toggleView('editor', true);
    expect(state().visibleLayout).toEqual([['editor']]);
  });

  it('closes the split when toggling the agent view with split chats open', () => {
    state().openChatInSplit('c2');
    state().toggleView('agent', true);
    expect(state().splitChatIds).toEqual([]);
    expect(state().visibleLayout).toEqual([['agent:primary']]);
  });

  it('shows a single view on mobile and returns to the agent on re-tap', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(400);
    state().toggleView('diff', true);
    expect(state().visibleLayout).toEqual([['diff']]);
    expect(state().openTabs).toEqual(['agent:primary', 'diff']);

    state().toggleView('diff', true);
    expect(state().visibleLayout).toEqual([['agent:primary']]);
    expect(state().openTabs).toEqual(['agent:primary']);
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
    state().toggleView('editor', false);
    expect(state().visibleLayout.flat()).toContain('editor');

    state().loadWorkspaceForChat('c2');
    expect(state().visibleLayout).toEqual([['agent:primary']]);

    state().loadWorkspaceForChat('c1');
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
  it('opens up to four chats using the specified agent grids', () => {
    state().openChatInSplit('c2');
    expect(state().splitChatIds).toEqual(['c2']);
    expect(state().visibleLayout).toEqual([['agent:primary', 'agent:split-1']]);

    state().openChatInSplit('c3');
    expect(state().splitChatIds).toEqual(['c2', 'c3']);
    expect(state().visibleLayout).toEqual([['agent:primary', 'agent:split-1', 'agent:split-2']]);

    state().openChatInSplit('c4');
    expect(state().splitChatIds).toEqual(['c2', 'c3', 'c4']);
    expect(state().visibleLayout).toEqual([
      ['agent:primary', 'agent:split-1'],
      ['agent:split-2', 'agent:split-3'],
    ]);
  });

  it('does not open a fifth chat', () => {
    state().openChatInSplit('c2');
    state().openChatInSplit('c3');
    state().openChatInSplit('c4');
    const before = state();
    state().openChatInSplit('c5');
    expect(state()).toBe(before);
    expect(state().chatTabs).not.toContain('c5');
  });

  it('focuses an existing split chat without duplicating it', () => {
    state().openChatInSplit('c2');
    state().openChatInSplit('c3');
    useUIStore.setState({
      openTabs: ['agent:primary'],
      focusedTile: 'agent:primary',
      activeAgentTile: 'agent:primary',
    });

    state().openChatInSplit('c2');

    expect(state().splitChatIds).toEqual(['c2', 'c3']);
    expect(state().focusedTile).toBe('agent:split-1');
    expect(state().activeAgentTile).toBe('agent:split-1');
    expect(state().openTabs).toEqual(['agent:primary', 'agent:split-1', 'agent:split-2']);
    expect(state().visibleLayout).toEqual([['agent:primary', 'agent:split-1', 'agent:split-2']]);
  });

  it('closes a middle slot and compacts higher tile suffixes', () => {
    state().openChatInSplit('c2');
    state().openChatInSplit('c3');
    state().openChatInSplit('c4');
    useUIStore.setState({
      openTabs: [
        'agent:primary',
        'agent:split-1',
        'agent:split-2',
        'diff:split-2',
        'agent:split-3',
        'editor:split-3',
      ],
      visibleLayout: [
        ['agent:primary', 'agent:split-1'],
        ['diff:split-2', 'agent:split-3', 'editor:split-3'],
      ],
      focusedTile: 'editor:split-3',
      activeAgentTile: 'agent:split-3',
    });

    state().closeSplitChat('c3');

    expect(state().splitChatIds).toEqual(['c2', 'c4']);
    expect(state().openTabs).toEqual([
      'agent:primary',
      'agent:split-1',
      'agent:split-2',
      'editor:split-2',
    ]);
    expect(state().visibleLayout).toEqual([
      ['agent:primary', 'agent:split-1'],
      ['agent:split-2', 'editor:split-2'],
    ]);
    expect(state().focusedTile).toBe('editor:split-2');
    expect(state().activeAgentTile).toBe('agent:split-2');
  });

  it('keeps a visible non-agent tile when closing the first of two split chats', () => {
    state().openChatInSplit('c2');
    state().openChatInSplit('c3');
    useUIStore.setState({
      openTabs: ['agent:primary', 'agent:split-1', 'agent:split-2', 'editor:split-2'],
      visibleLayout: [['agent:primary', 'agent:split-1', 'editor:split-2']],
      focusedTile: 'editor:split-2',
      activeAgentTile: 'agent:split-2',
    });

    state().closeSplitChat('c2');

    expect(state().splitChatIds).toEqual(['c3']);
    expect(state().visibleLayout).toEqual([['agent:primary', 'editor:split-1']]);
    expect(state().focusedTile).toBe('editor:split-1');
    expect(state().activeAgentTile).toBe('agent:split-1');
  });

  it('rebuilds the agent grid without changing focus', () => {
    state().openChatInSplit('c2');
    state().openChatInSplit('c3');
    useUIStore.setState({
      openTabs: ['agent:primary', 'editor:split-2'],
      visibleLayout: [['editor:split-2']],
      focusedTile: 'editor:split-2',
      activeAgentTile: 'agent:split-2',
    });

    state().rebuildSplitLayout();

    expect(state().openTabs).toEqual([
      'agent:primary',
      'editor:split-2',
      'agent:split-1',
      'agent:split-2',
    ]);
    expect(state().visibleLayout).toEqual([['agent:primary', 'agent:split-1', 'agent:split-2']]);
    expect(state().focusedTile).toBe('editor:split-2');
    expect(state().activeAgentTile).toBe('agent:split-2');
  });

  it('closes all split chats and clears their pending editor jump', () => {
    state().openChatInSplit('c2');
    state().openFileInEditor('a.ts', 'c2');
    state().closeSplitChat();

    expect(state().splitChatIds).toEqual([]);
    expect(state().openTabs.some((tile) => tile.includes(':split-'))).toBe(false);
    expect(state().visibleLayout).toEqual([['agent:primary']]);
    expect(state().activeAgentTile).toBe('agent:primary');
    expect(state().pendingFileOpen).toBeNull();
  });
});

describe('persist migration', () => {
  it('migrates the legacy split chat and tile suffix to slot one', () => {
    const legacyChatKey = 'secondary' + 'ChatId';
    const legacySuffix = ':second' + 'ary';
    const migrated = migrateUIState(
      {
        [legacyChatKey]: 'c2',
        openTabs: ['agent:primary', `agent${legacySuffix}`, `editor${legacySuffix}`],
        visibleLayout: [['agent:primary', `agent${legacySuffix}`]],
      },
      0,
    );

    expect(migrated).toEqual({
      splitChatIds: ['c2'],
      openTabs: ['agent:primary', 'agent:split-1', 'editor:split-1'],
      visibleLayout: [['agent:primary', 'agent:split-1']],
    });
  });
});

describe('removeTab', () => {
  it('never closes the base agent tab', () => {
    const before = state();
    state().removeTab('agent:primary');
    expect(useUIStore.getState()).toBe(before);
  });

  it('closes a focused view and lands focus back on the agent pane', () => {
    state().toggleView('editor', false);
    expect(state().focusedTile).toBe('editor');
    state().removeTab('editor');
    expect(state().openTabs).not.toContain('editor');
    expect(state().visibleLayout).toEqual([['agent:primary']]);
    expect(state().focusedTile).toBe('agent:primary');
  });

  it('closes only the chat owned by a split agent tile', () => {
    state().openChatInSplit('c2');
    state().openChatInSplit('c3');

    state().removeTab('agent:split-1');

    expect(state().splitChatIds).toEqual(['c3']);
    expect(state().openTabs).toEqual(['agent:primary', 'agent:split-1']);
  });
});
