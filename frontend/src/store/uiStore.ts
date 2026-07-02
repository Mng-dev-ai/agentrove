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
  WorkspaceLayout,
} from '@/types/ui.types';
import { MOBILE_BREAKPOINT } from '@/config/constants';
import {
  isSecondaryPaneActive,
  isSecondaryTile,
  tileIdToViewType,
  viewTypeToTileId,
} from '@/utils/tileHelpers';
import { clearTerminalStorage } from '@/utils/terminal';
import type { MenuMode } from '@/components/ui/commandRegistry';
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

type UIStoreState = ThemeState &
  Pick<UIState, 'sidebarOpen' | 'sidebarWidth'> &
  Pick<UIActions, 'setSidebarOpen' | 'setSidebarWidth'> &
  SplitViewState &
  SplitViewActions & {
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
    // claims it (the primary and secondary editors share these store fields).
    // `undefined` is the chat-less landing editor, which exposes workspace files
    // before any chat exists.
    pendingFileOpen: PendingFileOpen | null;
    openFileInEditor: (path: string, chatId: string | undefined, line?: number) => void;
    // `chatId` binds the jump to its chat so only that chat's diff tile claims
    // it — a jump can't be consumed by a different chat mounted in the same slot.
    pendingDiffFile: { path: string; chatId: string } | null;
    openInDiffView: (path: string, chatId: string) => void;
    consumeDiffFileJump: () => void;
    pendingChatMessage: { chatId: string; message: string } | null;
    setPendingChatMessage: (payload: { chatId: string; message: string } | null) => void;
    // Sandbox of the workspace selected on the landing page. Lets context-less
    // consumers (the global git shortcuts) resolve a target before a chat exists.
    workspaceSandboxId: string | null;
    setWorkspaceSandboxId: (sandboxId: string | null) => void;
  };

const getInitialSidebarState = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= MOBILE_BREAKPOINT;
};

const isDesktop = (): boolean =>
  typeof window !== 'undefined' && window.innerWidth >= MOBILE_BREAKPOINT;

// Which agent chat (primary vs secondary) a tile belongs to.
function agentTileFor(tileId: TileId): AgentTileId {
  return isSecondaryTile(tileId) ? 'agent:secondary' : 'agent:primary';
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

// The per-chat tabs we persist, stripped of split-chat (:secondary) tiles — those
// belong to the transient pairing, not the primary chat, and are rebuilt from
// secondaryChatId. Guards against an all-secondary layout collapsing to empty.
function ownTabs(openTabs: TileId[], visibleLayout: TileId[][]): WorkspaceLayout {
  const layout = filterLayout(visibleLayout, (t) => !isSecondaryTile(t));
  return {
    openTabs: openTabs.filter((t) => !isSecondaryTile(t)),
    visibleLayout: layout.length ? layout : [['agent:primary']],
  };
}

// The diff/editor jumps are chat-bound; a jump for a chat that's going away (its
// pane closed/replaced) is stale and would otherwise fire in the wrong tile.
function clearJumpsForChat(state: UIStoreState, chatId: string | null): Partial<UIStoreState> {
  const cleared: Partial<UIStoreState> = {};
  if (state.pendingDiffFile?.chatId === chatId) cleared.pendingDiffFile = null;
  if (state.pendingFileOpen?.chatId === chatId) cleared.pendingFileOpen = null;
  return cleared;
}

// A pending jump can't survive its own tile being closed. Only the tile that
// would have claimed it clears it: a secondary tile owns jumps for the secondary
// chat, the primary owns the rest.
function clearJumpsForTile(state: UIStoreState, tileId: TileId): Partial<UIStoreState> {
  const view = tileIdToViewType(tileId);
  if (view !== 'diff' && view !== 'editor') return {};
  const owns = (jump: { chatId: string | undefined } | null) =>
    !!jump &&
    (isSecondaryTile(tileId)
      ? jump.chatId === state.secondaryChatId
      : jump.chatId !== state.secondaryChatId);
  const cleared: Partial<UIStoreState> = {};
  if (view === 'diff' && owns(state.pendingDiffFile)) cleared.pendingDiffFile = null;
  if (view === 'editor' && owns(state.pendingFileOpen)) cleared.pendingFileOpen = null;
  return cleared;
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

      workspaceSandboxId: null,
      setWorkspaceSandboxId: (sandboxId) => set({ workspaceSandboxId: sandboxId }),

      pendingFileOpen: null,
      pendingDiffFile: null,
      consumeDiffFileJump: () => set({ pendingDiffFile: null }),
      openFileInEditor: (path, chatId, line) => {
        const state = get();
        const secondary = chatId === state.secondaryChatId;
        const tileId = viewTypeToTileId('editor', secondary);
        set({
          pendingFileOpen: {
            path,
            chatId,
            nonce: (state.pendingFileOpen?.nonce ?? 0) + 1,
            ...(line != null ? { line } : {}),
          },
          openTabs: state.openTabs.includes(tileId) ? state.openTabs : [...state.openTabs, tileId],
        });
        get().activateTab(tileId);
      },
      openInDiffView: (path, chatId) => {
        const state = get();
        const secondary = chatId === state.secondaryChatId;
        const tileId = viewTypeToTileId('diff', secondary);
        set({
          pendingDiffFile: { path, chatId },
          openTabs: state.openTabs.includes(tileId) ? state.openTabs : [...state.openTabs, tileId],
        });
        get().activateTab(tileId);
      },

      openTabs: ['agent:primary'],
      visibleLayout: [['agent:primary']],
      secondaryChatId: null,
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

      splitView: (direction, tileId) => {
        const state = get();
        if (!state.openTabs.includes(tileId)) return;
        // Already on screen — just focus it, don't duplicate it into the layout.
        // Otherwise 'row' adds it beside the last row, 'column' starts a new row.
        const visibleLayout = state.visibleLayout.flat().includes(tileId)
          ? state.visibleLayout
          : direction === 'row'
            ? appendToLastRow(state.visibleLayout, tileId)
            : [...state.visibleLayout, [tileId]];
        set({
          visibleLayout,
          focusedTile: tileId,
          activeAgentTile: agentTileFor(tileId),
        });
      },

      focusTile: (tileId) => {
        if (get().focusedTile === tileId) return;
        // Single focus path for both tab and pane clicks. activeAgentTile is the
        // coarsening of focusedTile (primary vs secondary chat). It stays a separate
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
          if (toggle && state.secondaryChatId) get().closeSplitChat();
          else get().activateTab('agent:primary');
          return;
        }
        const secondary = isSecondaryPaneActive(state.activeAgentTile, state.secondaryChatId);
        const tileId = viewTypeToTileId(view, secondary);
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
          if (toggle) get().removeTab(tileId);
          else get().activateTab(tileId);
        } else {
          set({ openTabs: [...state.openTabs, tileId] });
          get().activateTab(tileId);
        }
      },

      addViewToSplit: (view, direction) => {
        const state = get();
        // Split controls used from the secondary pane open <view>:secondary.
        const secondary = isSecondaryPaneActive(state.activeAgentTile, state.secondaryChatId);
        const tileId = viewTypeToTileId(view, secondary);
        if (!state.openTabs.includes(tileId)) set({ openTabs: [...state.openTabs, tileId] });
        get().splitView(direction, tileId);
      },

      removeTab: (tileId) => {
        const state = get();
        // The base agent tab can't be closed; the secondary agent tears down the split.
        if (tileId === 'agent:primary' || !state.openTabs.includes(tileId)) return;
        if (tileId === 'agent:secondary') {
          get().closeSplitChat();
          return;
        }
        const openTabs = state.openTabs.filter((t) => t !== tileId);
        let visibleLayout = filterLayout(state.visibleLayout, (t) => t !== tileId);
        // Never leave an empty viewport — fall back to the last remaining open tab.
        if (visibleLayout.length === 0) visibleLayout = [[openTabs[openTabs.length - 1]]];
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

      // Resets to a single agent view AND tears down any split chat — a lingering
      // secondaryChatId would otherwise be rebuilt into the next chat page.
      // Detaches from any chat so the next chat entry restores its own tabs.
      resetWorkspace: () =>
        set({
          openTabs: ['agent:primary'],
          visibleLayout: [['agent:primary']],
          secondaryChatId: null,
          activeAgentTile: 'agent:primary',
          focusedTile: null,
          currentWorkspaceChatId: null,
        }),

      loadWorkspaceForChat: (chatId) => {
        const state = get();
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
        set({ editorByChat: {}, layoutsByChat: {} });
        clearTerminalStorage();
      },

      openChatInSplit: (chatId) => {
        const state = get();
        // When the secondary slot shows a different chat, default the active pane
        // back to primary and drop a jump still pending for the replaced chat.
        const secondaryChanged = state.secondaryChatId !== chatId;
        const resetForNewSecondary: Partial<UIStoreState> = secondaryChanged
          ? {
              activeAgentTile: 'agent:primary',
              focusedTile: null,
              ...clearJumpsForChat(state, state.secondaryChatId),
            }
          : {};
        if (!isDesktop()) {
          if (state.secondaryChatId === chatId) return;
          set({ secondaryChatId: chatId, ...resetForNewSecondary });
          return;
        }
        const openTabs = state.openTabs.includes('agent:secondary')
          ? state.openTabs
          : [...state.openTabs, 'agent:secondary'];
        set({
          secondaryChatId: chatId,
          openTabs,
          // Show both agents side by side; other tabs drop to the background.
          visibleLayout: [['agent:primary', 'agent:secondary']],
          ...resetForNewSecondary,
        });
      },

      closeSplitChat: () => {
        const state = get();
        // Shared reset: focus back to primary, drop any jump aimed at the now-gone
        // secondary chat.
        const reset: Partial<UIStoreState> = {
          secondaryChatId: null,
          activeAgentTile: 'agent:primary',
          focusedTile: null,
          ...clearJumpsForChat(state, state.secondaryChatId),
        };
        if (state.openTabs.some(isSecondaryTile)) {
          const openTabs = state.openTabs.filter((t) => !isSecondaryTile(t));
          let visibleLayout = filterLayout(state.visibleLayout, (t) => !isSecondaryTile(t));
          if (visibleLayout.length === 0) visibleLayout = [['agent:primary']];
          set({ ...reset, openTabs, visibleLayout });
        } else if (state.secondaryChatId !== null) {
          set(reset);
        }
      },

      swapChatPanes: (currentPrimaryChatId) => {
        const state = get();
        const newPrimary = state.secondaryChatId;
        if (!newPrimary) return null;
        set({ secondaryChatId: currentPrimaryChatId });
        return newPrimary;
      },
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        theme: state.theme,
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        secondaryChatId: state.secondaryChatId,
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
      }),
    },
  ),
);
