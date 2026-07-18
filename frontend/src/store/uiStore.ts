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
  // Re-opens can repeat the same path/line after the user scrolls away.
  nonce: number;
}

export interface EditorCodeSelection {
  path: string;
  startLine: number;
  endLine: number;
  languageId: string;
  text: string;
  // Set by diff-view review comments; serialized under the code block at send time.
  comment?: string;
}

// Text selected from rendered chat messages — no file/line identity.
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
    // Sidebar chat-list filters — persisted so a reload keeps the narrowed view
    sidebarFilters: SidebarFilters;
    setSidebarFilters: (filters: SidebarFilters) => void;
    commandMenuOpen: boolean;
    setCommandMenuOpen: (open: boolean) => void;
    // Set by `executeCommand` when a mode-switching command (search, files, branches)
    // reopens the menu, then consumed and cleared by CommandMenu on next open.
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
    // `chatId` binds the open/jump to its chat so only that chat's editor tile
    // claims it (the primary and split editors share these store fields).
    // `undefined` is the chat-less landing editor, which exposes workspace files
    // before any chat exists.
    pendingFileOpen: PendingFileOpen | null;
    openFileInEditor: (path: string, chatId: string | undefined, line?: number) => void;
    pendingChatMessage: { chatId: string; message: string } | null;
    setPendingChatMessage: (payload: { chatId: string; message: string } | null) => void;
    // Editor snippets / chat-text selections attached to a chat's input as
    // removable chips (VS Code "add selection to chat") — serialized into the
    // prompt only at send time.
    composerSelectionsByChat: Record<string, ComposerSelection[]>;
    addComposerSelection: (chatId: string, selection: ComposerSelection) => void;
    removeComposerSelection: (chatId: string, index: number) => void;
    clearComposerSelections: (chatId: string) => void;
    // Sandbox of the workspace selected on the landing page. Lets context-less
    // consumers (the global git shortcuts) resolve a target before a chat exists.
    workspaceSandboxId: string | null;
    setWorkspaceSandboxId: (sandboxId: string | null) => void;
    // Working set of chats shown as title-bar tabs — only explicitly opened
    // chats, ordered by open time; the sidebar remains the full archive.
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

// Which agent chat a tile belongs to.
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

// Drops tiles from the layout, removing any row left empty.
function filterLayout(layout: TileId[][], keep: (tileId: TileId) => boolean): TileId[][] {
  return layout.map((row) => row.filter(keep)).filter((row) => row.length > 0);
}

// Appends a tile to the last row (side-by-side split).
function appendToLastRow(layout: TileId[][], tileId: TileId): TileId[][] {
  if (layout.length === 0) return [[tileId]];
  return layout.map((row, i) => (i === layout.length - 1 ? [...row, tileId] : row));
}

// Last tile in layout order — the fallback focus target after a removal.
function lastVisibleTile(layout: TileId[][]): TileId {
  const flat = layout.flat();
  return flat[flat.length - 1];
}

// The per-chat tabs we persist exclude transient split-chat tiles. Guards
// against an all-split layout collapsing to empty.
function ownTabs(openTabs: TileId[], visibleLayout: TileId[][]): WorkspaceLayout {
  const layout = filterLayout(visibleLayout, (t) => !isSplitTile(t));
  return {
    openTabs: openTabs.filter((t) => !isSplitTile(t)),
    visibleLayout: layout.length ? layout : [['agent:primary']],
  };
}

// The editor jump is chat-bound; a jump for a chat that's going away (its pane
// closed/replaced) is stale and would otherwise fire in the wrong tile.
function clearJumpsForChat(state: UIStoreState, chatId: string | null): Partial<UIStoreState> {
  const cleared: Partial<UIStoreState> = {};
  if (state.pendingFileOpen?.chatId === chatId) cleared.pendingFileOpen = null;
  return cleared;
}

// A pending jump can't survive its own tile being closed. Only the tile that
// would have claimed it clears it: a split tile owns its bound chat, and the
// primary owns chats not bound to any split slot.
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
      openFileInEditor: (path, chatId, line) => {
        const state = get();
        const splitIndex = chatId ? state.splitChatIds.indexOf(chatId) : -1;
        const slot = splitIndex >= 0 ? splitSlotAt(splitIndex) : null;
        const tileId = viewTypeToTileId('editor', slot);
        set({
          pendingFileOpen: {
            path,
            chatId,
            nonce: (state.pendingFileOpen?.nonce ?? 0) + 1,
            ...(line != null ? { line } : {}),
          },
          openTabs: state.openTabs.includes(tileId) ? state.openTabs : [...state.openTabs, tileId],
        });
        // Editor already on screen (possibly in a split) — keep the layout and just
        // focus it; activateTab would collapse the split to a full-view editor.
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
        // Single focus path for both tab and pane clicks. activeAgentTile is the
        // coarsening of focusedTile (primary vs split chat). It stays a separate
        // field because focusedTile is nullable (no interaction yet) while the ~6
        // imperative coarse readers need an always-defined value — collapsing would
        // scatter `?? 'agent:primary'` fallbacks across all of them.
        set({ focusedTile: tileId, activeAgentTile: agentTileFor(tileId) });
      },

      toggleView: (view, toggle) => {
        const state = get();
        // Agent is the base view and is never torn down to nothing; toggling it
        // just closes any split chat or re-focuses the primary pane.
        if (view === 'agent') {
          if (toggle && state.splitChatIds.length > 0) get().closeSplitChat();
          else get().activateTab('agent:primary');
          return;
        }
        const slot = activeSplitSlot(state.activeAgentTile, state.splitChatIds);
        const tileId = viewTypeToTileId(view, slot);
        // Mobile shows one view; re-tapping the on-screen view returns to agent.
        if (!isDesktop()) {
          const target =
            toggle && state.visibleLayout[0]?.[0] === tileId ? 'agent:primary' : tileId;
          // Keep agent:primary open even when a non-agent view fills the screen, so
          // the Agent command/icon can always switch back to it (activateTab guards
          // on openTabs membership).
          set({
            openTabs: target === 'agent:primary' ? ['agent:primary'] : ['agent:primary', target],
            visibleLayout: [[target]],
            focusedTile: target,
            activeAgentTile: agentTileFor(target),
          });
          return;
        }
        if (state.openTabs.includes(tileId)) {
          // Views have no tabs, so toggle keys on visibility: an on-screen view
          // closes; one kept mounted in the background resurfaces instead.
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
        // Already on screen — just focus it, don't duplicate it into the layout.
        // Otherwise 'row' adds it beside the last row, 'column' starts a new row.
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
        // The base agent tab can't be closed; a split agent tears down its chat pane.
        if (tileId === 'agent:primary' || !state.openTabs.includes(tileId)) return;
        const splitSlot = splitSlotOfTile(tileId);
        if (tileIdToViewType(tileId) === 'agent' && splitSlot) {
          get().closeSplitChat(state.splitChatIds[splitSlot - 1]);
          return;
        }
        const openTabs = state.openTabs.filter((t) => t !== tileId);
        let visibleLayout = filterLayout(state.visibleLayout, (t) => t !== tileId);
        // Never leave an empty viewport — closing a full-screen view lands back on
        // its own chat's agent pane, not whatever background view happened to
        // be opened last.
        if (visibleLayout.length === 0) {
          const owner = agentTileFor(tileId);
          visibleLayout = [[openTabs.includes(owner) ? owner : 'agent:primary']];
        }
        const patch: Partial<UIStoreState> = {
          openTabs,
          visibleLayout,
          ...clearJumpsForTile(state, tileId),
        };
        // If the focused tile went away, re-aim at a surviving visible pane.
        if (state.focusedTile === tileId) {
          const next = lastVisibleTile(visibleLayout);
          patch.focusedTile = next;
          patch.activeAgentTile = agentTileFor(next);
        }
        set(patch);
      },

      // Resets to a single agent view AND tears down any split chat.
      // Detaches from any chat so the next chat entry restores its own tabs.
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
        // Visiting a chat adds it to the title-bar working set — runs before the
        // early return so a rehydrated same-chat entry still keeps its tab.
        get().openChatTab(chatId);
        if (state.currentWorkspaceChatId === chatId) return;
        const layoutsByChat = { ...state.layoutsByChat };
        // Stash the chat we're leaving before swapping in the new one's tabs.
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
          // Deleting the on-screen chat navigates away after this runs, and
          // ChatPage's unmount stash would write the deleted entry right back —
          // null the live pointer so that stash no-ops (same resurrection guard
          // as cleanupAllChats).
          ...(state.currentWorkspaceChatId === chatId ? { currentWorkspaceChatId: null } : {}),
        });
        clearTerminalStorage(chatId);
      },

      cleanupAllChats: () => {
        // The live workspace (openTabs, currentWorkspaceChatId, split) may still
        // reference a deleted chat — without the reset, the next
        // loadWorkspaceForChat would stash it right back into layoutsByChat.
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
        // A chat opened in split joins the working set — it stays reachable from
        // the tab strip after the split closes.
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
        // Status filters read session-only stream state that's empty at mount —
        // persisting them would rehydrate a view that can't match anything.
        // Only the durable dimensions (agent/source/workspace) survive reloads.
        sidebarFilters: { ...state.sidebarFilters, statuses: [] },
        splitChatIds: state.splitChatIds,
        // Persist the live workspace so a refresh restores the active view/tabs.
        // currentWorkspaceChatId must rehydrate too: loadWorkspaceForChat
        // early-returns when it matches the route chat, leaving this layout intact
        // instead of resetting to the default agent view.
        openTabs: state.openTabs,
        visibleLayout: state.visibleLayout,
        currentWorkspaceChatId: state.currentWorkspaceChatId,
        // Persist each chat's open files + active file so a refresh reopens what
        // the user had open, instead of rehydrating to an empty editor.
        editorByChat: state.editorByChat,
        chatTabs: state.chatTabs,
      }),
      version: 1,
      migrate: migrateUIState,
      // Backfill filter fields added after a user first persisted state (e.g.
      // groupBy) — the default shallow merge would rehydrate them as undefined.
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
