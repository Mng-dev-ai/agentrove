import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ThemeState,
  UIState,
  UIActions,
  SplitViewState,
  SplitViewActions,
  TileId,
  AgentTileId,
  SplitSlot,
  WorkspaceLayout,
} from '@/types/ui.types';
import { MAX_CHAT_PANES } from '@/types/ui.types';
import { MOBILE_BREAKPOINT } from '@/config/constants';
import {
  activeSplitSlot,
  isSplitTile,
  splitSlotOfTile,
  tileIdToViewType,
  viewTypeToTileId,
} from '@/utils/tileHelpers';
import { clearTerminalStorage } from '@/utils/terminal';
import type { MenuMode } from '@/components/ui/command-menu/commandRegistry';
import { EMPTY_SIDEBAR_FILTERS, type SidebarFilters } from '@/store/sidebarFilters';
import { THEME_CYCLE } from '@/utils/theme';

export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 560;
export const DEFAULT_SIDEBAR_WIDTH = 300;

export const clampSidebarWidth = (width: number): number =>
  Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width)));

interface PendingFileOpen {
  path: string;
  chatId: string | undefined;
  line?: number;
  // Bumps so re-opening the same path/line still focuses after scroll-away.
  nonce: number;
}

export interface EditorCodeSelection {
  path: string;
  startLine: number;
  endLine: number;
  languageId: string;
  text: string;
  // Diff-view review comment; serialized under the code block at send.
  comment?: string;
}

// Chat message selection — no file/line identity.
export interface ChatTextSelection {
  kind: 'chat';
  text: string;
}

export type ComposerSelection = EditorCodeSelection | ChatTextSelection;

type UIStoreState = ThemeState &
  Pick<UIState, 'sidebarOpen' | 'sidebarWidth'> &
  Pick<UIActions, 'setSidebarOpen' | 'setSidebarWidth'> &
  SplitViewState &
  SplitViewActions & {
    // Persisted so reload keeps the narrowed sidebar view.
    sidebarFilters: SidebarFilters;
    setSidebarFilters: (filters: SidebarFilters) => void;
    commandMenuOpen: boolean;
    setCommandMenuOpen: (open: boolean) => void;
    // Mode-switch commands set this; CommandMenu consumes it on next open.
    pendingMenuMode: MenuMode | null;
    setPendingMenuMode: (mode: MenuMode | null) => void;
    subThreadDialogOpen: boolean;
    setSubThreadDialogOpen: (open: boolean) => void;
    createPRDialogOpen: boolean;
    setCreatePRDialogOpen: (open: boolean) => void;
    createBranchDialogOpen: boolean;
    setCreateBranchDialogOpen: (open: boolean) => void;
    createCommitDialogOpen: boolean;
    setCreateCommitDialogOpen: (open: boolean) => void;
    // chatId binds the jump to one editor tile; undefined = landing editor.
    pendingFileOpen: PendingFileOpen | null;
    // Monotonic — consumers null pendingFileOpen, so its nonce can't seed the next.
    fileOpenNonce: number;
    openFileInEditor: (path: string, chatId: string | undefined, line?: number) => void;
    pendingChatMessage: { chatId: string; message: string } | null;
    setPendingChatMessage: (payload: { chatId: string; message: string } | null) => void;
    // Selection chips for a chat's input; serialized into the prompt at send.
    composerSelectionsByChat: Record<string, ComposerSelection[]>;
    addComposerSelection: (chatId: string, selection: ComposerSelection) => void;
    removeComposerSelection: (chatId: string, index: number) => void;
    clearComposerSelections: (chatId: string) => void;
    // Landing workspace sandbox for git shortcuts before a chat exists.
    workspaceSandboxId: string | null;
    setWorkspaceSandboxId: (sandboxId: string | null) => void;
    // Title-bar working set (explicitly opened); sidebar is the full archive.
    chatTabs: string[];
    openChatTab: (chatId: string) => void;
    closeChatTab: (chatId: string) => void;
  };

const getInitialSidebarState = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= MOBILE_BREAKPOINT;
};

const isDesktop = (): boolean =>
  typeof window !== 'undefined' && window.innerWidth >= MOBILE_BREAKPOINT;

function splitAgentTile(slot: SplitSlot): AgentTileId {
  return `agent:split-${slot}`;
}

function splitSlotAt(index: number): SplitSlot {
  if (index === 0) return 1;
  if (index === 1) return 2;
  return 3;
}

function agentTileFor(tileId: TileId): AgentTileId {
  const slot = splitSlotOfTile(tileId);
  return slot ? splitAgentTile(slot) : 'agent:primary';
}

function agentGridFor(paneCount: number): TileId[][] {
  if (paneCount === 2) return [['agent:primary', 'agent:split-1']];
  if (paneCount === 3) return [['agent:primary', 'agent:split-1', 'agent:split-2']];
  if (paneCount === 4) {
    return [
      ['agent:primary', 'agent:split-1'],
      ['agent:split-2', 'agent:split-3'],
    ];
  }
  return [['agent:primary']];
}

function rebuildSplitGrid(
  state: UIStoreState,
  splitChatIds: string[],
): Pick<UIStoreState, 'openTabs' | 'visibleLayout'> {
  const visibleLayout = agentGridFor(1 + splitChatIds.length);
  const agentTiles = visibleLayout.flat();
  return {
    openTabs: [...state.openTabs, ...agentTiles.filter((tile) => !state.openTabs.includes(tile))],
    visibleLayout,
  };
}

function filterLayout(layout: TileId[][], keep: (tileId: TileId) => boolean): TileId[][] {
  return layout.map((row) => row.filter(keep)).filter((row) => row.length > 0);
}

function appendToLastRow(layout: TileId[][], tileId: TileId): TileId[][] {
  if (layout.length === 0) return [[tileId]];
  return layout.map((row, i) => (i === layout.length - 1 ? [...row, tileId] : row));
}

function lastVisibleTile(layout: TileId[][]): TileId {
  const flat = layout.flat();
  return flat[flat.length - 1];
}

// Persist without split-chat tiles so an all-split layout can't collapse empty.
function ownTabs(openTabs: TileId[], visibleLayout: TileId[][]): WorkspaceLayout {
  const layout = filterLayout(visibleLayout, (t) => !isSplitTile(t));
  return {
    openTabs: openTabs.filter((t) => !isSplitTile(t)),
    visibleLayout: layout.length ? layout : [['agent:primary']],
  };
}

// Drop jumps for a chat whose pane is going away (would fire in the wrong tile).
function clearJumpsForChat(state: UIStoreState, chatId: string | null): Partial<UIStoreState> {
  const cleared: Partial<UIStoreState> = {};
  if (state.pendingFileOpen?.chatId === chatId) cleared.pendingFileOpen = null;
  return cleared;
}

// Only the tile that would claim the jump clears it (split owns its chat; primary owns the rest).
function clearJumpsForTile(state: UIStoreState, tileId: TileId): Partial<UIStoreState> {
  if (tileIdToViewType(tileId) !== 'editor') return {};
  const jump = state.pendingFileOpen;
  if (!jump) return {};
  const slot = splitSlotOfTile(tileId);
  const owns = slot
    ? jump.chatId === state.splitChatIds[slot - 1]
    : !jump.chatId || !state.splitChatIds.includes(jump.chatId);
  return owns ? { pendingFileOpen: null } : {};
}

function compactTileAfter(tileId: TileId, closedSlot: SplitSlot): TileId | null {
  const slot = splitSlotOfTile(tileId);
  if (!slot || slot < closedSlot) return tileId;
  if (slot === closedSlot) return null;
  return `${tileIdToViewType(tileId)}:split-${(slot - 1) as SplitSlot}`;
}

function compactLayout(layout: TileId[][], closedSlot: SplitSlot): TileId[][] {
  return layout
    .map((row) =>
      row.map((tile) => compactTileAfter(tile, closedSlot)).filter((tile) => tile !== null),
    )
    .filter((row) => row.length > 0);
}

type LegacyPersistedUIState = Omit<
  Partial<UIStoreState>,
  'openTabs' | 'visibleLayout' | 'splitChatIds'
> & {
  secondaryChatId?: string | null;
  openTabs?: string[];
  visibleLayout?: string[][];
};

export function migrateUIState(persisted: unknown, version: number): unknown {
  if (version !== 0 || !persisted || typeof persisted !== 'object') return persisted;
  const stored = persisted as LegacyPersistedUIState;
  const migrateTile = (tileId: string): TileId | null => {
    if (tileId === 'agent:primary') return 'agent:primary';
    if (tileId === 'diff' || tileId === 'editor' || tileId === 'terminal') return tileId;
    if (tileId === 'agent:secondary') return 'agent:split-1';
    if (tileId === 'diff:secondary') return 'diff:split-1';
    if (tileId === 'editor:secondary') return 'editor:split-1';
    if (tileId === 'terminal:secondary') return 'terminal:split-1';
    return null;
  };
  const migrateTiles = (tileIds: string[]): TileId[] =>
    tileIds.map(migrateTile).filter((tileId) => tileId !== null);
  const { secondaryChatId, ...rest } = stored;
  return {
    ...rest,
    splitChatIds: secondaryChatId ? [secondaryChatId] : [],
    ...(stored.openTabs ? { openTabs: migrateTiles(stored.openTabs) } : {}),
    ...(stored.visibleLayout
      ? { visibleLayout: stored.visibleLayout.map(migrateTiles).filter((row) => row.length > 0) }
      : {}),
  };
}

export const useUIStore = create<UIStoreState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      toggleTheme: () =>
        set((state) => {
          const i = THEME_CYCLE.indexOf(state.theme);
          return { theme: THEME_CYCLE[(i + 1) % THEME_CYCLE.length] };
        }),
      setTheme: (theme) => set({ theme }),
      sidebarOpen: getInitialSidebarState(),
      setSidebarOpen: (isOpen) => set({ sidebarOpen: isOpen }),
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      setSidebarWidth: (width) => {
        const next = clampSidebarWidth(width);
        if (next === get().sidebarWidth) return;
        set({ sidebarWidth: next });
      },
      sidebarFilters: EMPTY_SIDEBAR_FILTERS,
      setSidebarFilters: (filters) => set({ sidebarFilters: filters }),

      commandMenuOpen: false,
      setCommandMenuOpen: (open) => set({ commandMenuOpen: open }),
      pendingMenuMode: null,
      setPendingMenuMode: (mode) => set({ pendingMenuMode: mode }),
      subThreadDialogOpen: false,
      setSubThreadDialogOpen: (open) => set({ subThreadDialogOpen: open }),
      createPRDialogOpen: false,
      setCreatePRDialogOpen: (open) => set({ createPRDialogOpen: open }),
      createBranchDialogOpen: false,
      setCreateBranchDialogOpen: (open) => set({ createBranchDialogOpen: open }),
      createCommitDialogOpen: false,
      setCreateCommitDialogOpen: (open) => set({ createCommitDialogOpen: open }),

      pendingChatMessage: null,
      setPendingChatMessage: (payload) => set({ pendingChatMessage: payload }),

      composerSelectionsByChat: {},
      addComposerSelection: (chatId, selection) =>
        set((state) => ({
          composerSelectionsByChat: {
            ...state.composerSelectionsByChat,
            [chatId]: [...(state.composerSelectionsByChat[chatId] ?? []), selection],
          },
        })),
      removeComposerSelection: (chatId, index) =>
        set((state) => ({
          composerSelectionsByChat: {
            ...state.composerSelectionsByChat,
            [chatId]: (state.composerSelectionsByChat[chatId] ?? []).filter((_, i) => i !== index),
          },
        })),
      clearComposerSelections: (chatId) =>
        set((state) => ({
          composerSelectionsByChat: { ...state.composerSelectionsByChat, [chatId]: [] },
        })),

      workspaceSandboxId: null,
      setWorkspaceSandboxId: (sandboxId) => set({ workspaceSandboxId: sandboxId }),

      chatTabs: [],
      openChatTab: (chatId) => {
        const { chatTabs } = get();
        if (chatTabs.includes(chatId)) return;
        set({ chatTabs: [...chatTabs, chatId] });
      },
      closeChatTab: (chatId) => {
        const { chatTabs } = get();
        if (!chatTabs.includes(chatId)) return;
        set({ chatTabs: chatTabs.filter((id) => id !== chatId) });
      },

      pendingFileOpen: null,
      fileOpenNonce: 0,
      openFileInEditor: (path, chatId, line) => {
        const state = get();
        const splitIndex = chatId ? state.splitChatIds.indexOf(chatId) : -1;
        const slot = splitIndex >= 0 ? splitSlotAt(splitIndex) : null;
        const tileId = viewTypeToTileId('editor', slot);
        const nonce = state.fileOpenNonce + 1;
        set({
          fileOpenNonce: nonce,
          pendingFileOpen: {
            path,
            chatId,
            nonce,
            ...(line != null ? { line } : {}),
          },
          openTabs: state.openTabs.includes(tileId) ? state.openTabs : [...state.openTabs, tileId],
        });
        // Already visible — focus only; activateTab would collapse a split.
        if (state.visibleLayout.flat().includes(tileId)) get().focusTile(tileId);
        else get().activateTab(tileId);
      },

      openTabs: ['agent:primary'],
      visibleLayout: [['agent:primary']],
      splitChatIds: [],
      activeAgentTile: 'agent:primary',
      focusedTile: null,
      layoutsByChat: {},
      editorByChat: {},
      currentWorkspaceChatId: null,

      activateTab: (tileId) => {
        const state = get();
        if (!state.openTabs.includes(tileId)) return;
        set({
          visibleLayout: [[tileId]],
          focusedTile: tileId,
          activeAgentTile: agentTileFor(tileId),
        });
      },

      focusTile: (tileId) => {
        if (get().focusedTile === tileId) return;
        // activeAgentTile is always-defined coarsening of nullable focusedTile.
        set({ focusedTile: tileId, activeAgentTile: agentTileFor(tileId) });
      },

      toggleView: (view, toggle) => {
        const state = get();
        // Agent is never torn down; toggle closes split or re-focuses primary.
        if (view === 'agent') {
          if (toggle && state.splitChatIds.length > 0) get().closeSplitChat();
          else get().activateTab('agent:primary');
          return;
        }
        const slot = activeSplitSlot(state.activeAgentTile, state.splitChatIds);
        const tileId = viewTypeToTileId(view, slot);
        // Mobile: one view; re-tap returns to agent.
        if (!isDesktop()) {
          const target =
            toggle && state.visibleLayout[0]?.[0] === tileId ? 'agent:primary' : tileId;
          // Keep agent:primary in openTabs so activateTab can switch back.
          set({
            openTabs: target === 'agent:primary' ? ['agent:primary'] : ['agent:primary', target],
            visibleLayout: [[target]],
            focusedTile: target,
            activeAgentTile: agentTileFor(target),
          });
          return;
        }
        if (state.openTabs.includes(tileId)) {
          // Toggle by visibility: on-screen closes; background resurfaces.
          if (toggle && state.visibleLayout.flat().includes(tileId)) get().removeTab(tileId);
          else get().activateTab(tileId);
        } else {
          set({ openTabs: [...state.openTabs, tileId] });
          get().activateTab(tileId);
        }
      },

      addViewToSplit: (view, direction) => {
        const state = get();
        const slot = activeSplitSlot(state.activeAgentTile, state.splitChatIds);
        const tileId = viewTypeToTileId(view, slot);
        // Already visible → focus only; else row = beside last, column = new row.
        const visibleLayout = state.visibleLayout.flat().includes(tileId)
          ? state.visibleLayout
          : direction === 'row'
            ? appendToLastRow(state.visibleLayout, tileId)
            : [...state.visibleLayout, [tileId]];
        set({
          openTabs: state.openTabs.includes(tileId) ? state.openTabs : [...state.openTabs, tileId],
          visibleLayout,
          focusedTile: tileId,
          activeAgentTile: agentTileFor(tileId),
        });
      },

      removeTab: (tileId) => {
        const state = get();
        // agent:primary can't close; split agent tears down its chat pane.
        if (tileId === 'agent:primary' || !state.openTabs.includes(tileId)) return;
        const splitSlot = splitSlotOfTile(tileId);
        if (tileIdToViewType(tileId) === 'agent' && splitSlot) {
          get().closeSplitChat(state.splitChatIds[splitSlot - 1]);
          return;
        }
        const openTabs = state.openTabs.filter((t) => t !== tileId);
        let visibleLayout = filterLayout(state.visibleLayout, (t) => t !== tileId);
        // Never empty the viewport — fall back to this chat's agent pane.
        if (visibleLayout.length === 0) {
          const owner = agentTileFor(tileId);
          visibleLayout = [[openTabs.includes(owner) ? owner : 'agent:primary']];
        }
        const patch: Partial<UIStoreState> = {
          openTabs,
          visibleLayout,
          ...clearJumpsForTile(state, tileId),
        };
        if (state.focusedTile === tileId) {
          const next = lastVisibleTile(visibleLayout);
          patch.focusedTile = next;
          patch.activeAgentTile = agentTileFor(next);
        }
        set(patch);
      },

      // Single agent view, no split; detaches so the next chat restores its tabs.
      resetWorkspace: () =>
        set({
          openTabs: ['agent:primary'],
          visibleLayout: [['agent:primary']],
          splitChatIds: [],
          activeAgentTile: 'agent:primary',
          focusedTile: null,
          currentWorkspaceChatId: null,
        }),

      loadWorkspaceForChat: (chatId) => {
        const state = get();
        // Before early-return so same-chat rehydrate still keeps the title tab.
        get().openChatTab(chatId);
        if (state.currentWorkspaceChatId === chatId) return;
        const layoutsByChat = { ...state.layoutsByChat };
        if (state.currentWorkspaceChatId) {
          layoutsByChat[state.currentWorkspaceChatId] = ownTabs(
            state.openTabs,
            state.visibleLayout,
          );
        }
        const restored = layoutsByChat[chatId] ?? {
          openTabs: ['agent:primary'],
          visibleLayout: [['agent:primary']],
        };
        set({
          layoutsByChat,
          currentWorkspaceChatId: chatId,
          openTabs: restored.openTabs,
          visibleLayout: restored.visibleLayout,
        });
      },

      stashWorkspace: () => {
        const state = get();
        if (!state.currentWorkspaceChatId) return;
        set({
          layoutsByChat: {
            ...state.layoutsByChat,
            [state.currentWorkspaceChatId]: ownTabs(state.openTabs, state.visibleLayout),
          },
        });
      },

      cleanupChat: (chatId) => {
        const state = get();
        const editorByChat = { ...state.editorByChat };
        delete editorByChat[chatId];
        const layoutsByChat = { ...state.layoutsByChat };
        delete layoutsByChat[chatId];
        set({
          editorByChat,
          layoutsByChat,
          chatTabs: state.chatTabs.filter((id) => id !== chatId),
          // Null live pointer so ChatPage unmount stash can't resurrect the deleted chat.
          ...(state.currentWorkspaceChatId === chatId ? { currentWorkspaceChatId: null } : {}),
        });
        clearTerminalStorage(chatId);
      },

      cleanupAllChats: () => {
        // Reset first so the next loadWorkspaceForChat can't re-stash deleted chats.
        get().resetWorkspace();
        set({ editorByChat: {}, layoutsByChat: {}, chatTabs: [] });
        clearTerminalStorage();
      },

      openChatInSplit: (chatId) => {
        const state = get();
        const existingIndex = state.splitChatIds.indexOf(chatId);
        if (existingIndex >= 0) {
          get().openChatTab(chatId);
          if (!isDesktop()) return;
          const tile = splitAgentTile(splitSlotAt(existingIndex));
          set(rebuildSplitGrid(state, state.splitChatIds));
          get().focusTile(tile);
          return;
        }
        if (state.splitChatIds.length >= MAX_CHAT_PANES - 1) return;
        // Join working set so the chat stays in the tab strip after split closes.
        get().openChatTab(chatId);
        const splitChatIds = [...state.splitChatIds, chatId];
        const resetFocus: Pick<UIStoreState, 'activeAgentTile' | 'focusedTile'> = {
          activeAgentTile: 'agent:primary',
          focusedTile: null,
        };
        if (!isDesktop()) {
          set({ splitChatIds, ...resetFocus });
          return;
        }
        set({
          splitChatIds,
          ...rebuildSplitGrid(state, splitChatIds),
          ...resetFocus,
        });
      },

      rebuildSplitLayout: () => {
        const state = get();
        if (state.splitChatIds.length === 0) return;
        set(rebuildSplitGrid(state, state.splitChatIds));
      },

      closeSplitChat: (chatId) => {
        const state = get();
        if (chatId === undefined) {
          if (state.splitChatIds.length === 0 && !state.openTabs.some(isSplitTile)) return;
          const openTabs = state.openTabs.filter((tile) => !isSplitTile(tile));
          let visibleLayout = filterLayout(state.visibleLayout, (tile) => !isSplitTile(tile));
          if (visibleLayout.length === 0) visibleLayout = [['agent:primary']];
          const clearJump = state.pendingFileOpen?.chatId
            ? state.splitChatIds.includes(state.pendingFileOpen.chatId)
            : false;
          set({
            splitChatIds: [],
            openTabs,
            visibleLayout,
            activeAgentTile: 'agent:primary',
            focusedTile: null,
            ...(clearJump ? { pendingFileOpen: null } : {}),
          });
          return;
        }

        const index = state.splitChatIds.indexOf(chatId);
        if (index < 0) return;
        const closedSlot = splitSlotAt(index);
        const splitChatIds = state.splitChatIds.filter((id) => id !== chatId);
        const openTabs = state.openTabs
          .map((tile) => compactTileAfter(tile, closedSlot))
          .filter((tile) => tile !== null);
        let visibleLayout = compactLayout(state.visibleLayout, closedSlot);
        if (visibleLayout.length === 0) visibleLayout = [['agent:primary']];

        const compactedFocus = state.focusedTile
          ? compactTileAfter(state.focusedTile, closedSlot)
          : null;
        let focusedTile = compactedFocus;
        const compactedActive = compactTileAfter(state.activeAgentTile, closedSlot);
        let activeAgentTile = compactedActive ? agentTileFor(compactedActive) : 'agent:primary';
        if (state.focusedTile && !compactedFocus) {
          focusedTile = lastVisibleTile(visibleLayout);
          activeAgentTile = agentTileFor(focusedTile);
        }
        set({
          splitChatIds,
          openTabs,
          visibleLayout,
          focusedTile,
          activeAgentTile,
          ...clearJumpsForChat(state, chatId),
        });
      },
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        theme: state.theme,
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        // Status filters are session-only (empty at mount) — don't persist them.
        sidebarFilters: { ...state.sidebarFilters, statuses: [] },
        splitChatIds: state.splitChatIds,
        // Live workspace + currentWorkspaceChatId so refresh doesn't reset layout.
        openTabs: state.openTabs,
        visibleLayout: state.visibleLayout,
        currentWorkspaceChatId: state.currentWorkspaceChatId,
        editorByChat: state.editorByChat,
        chatTabs: state.chatTabs,
      }),
      version: 1,
      migrate: migrateUIState,
      // Backfill new filter fields (e.g. groupBy) the shallow merge would leave undefined.
      merge: (persisted, current) => {
        const stored = persisted as Partial<UIStoreState> | undefined;
        return {
          ...current,
          ...stored,
          sidebarFilters: { ...EMPTY_SIDEBAR_FILTERS, ...stored?.sidebarFilters },
        };
      },
    },
  ),
);
