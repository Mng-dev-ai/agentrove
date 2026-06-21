import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ThemeState,
  UIState,
  UIActions,
  SplitViewState,
  SplitViewActions,
  MosaicTileId,
  MosaicLayoutNode,
} from '@/types/ui.types';
import { MOBILE_BREAKPOINT } from '@/config/constants';
import {
  getEffectiveLayout,
  getLeafViewTypes,
  getLeaves,
  isMosaicSplitNode,
  isSecondaryPaneActive,
  isSecondaryTile,
  removeTileFromLayout,
  SECONDARY_TILE_IDS,
  tileIdToViewType,
  viewTypeToPrimaryTile,
  viewTypeToTileId,
} from '@/utils/mosaicHelpers';
import type { MenuMode } from '@/components/ui/commandRegistry';
import { THEME_CYCLE } from '@/utils/theme';

export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 560;
export const DEFAULT_SIDEBAR_WIDTH = 300;

export const clampSidebarWidth = (width: number): number =>
  Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width)));

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
    pendingFilePath: { path: string; chatId: string | undefined } | null;
    // Nonce lets the consumer re-jump even when path+line repeat, so that clicking
    // the same search result after scrolling away still reveals it.
    pendingFileJump: {
      path: string;
      line: number;
      nonce: number;
      chatId: string | undefined;
    } | null;
    openFileInEditor: (path: string, chatId: string | undefined, line?: number) => void;
    consumeFileJump: () => void;
    // `chatId` binds the jump to its chat so only that chat's diff tile claims
    // it — a jump can't be consumed by a different chat mounted in the same slot.
    pendingDiffFile: { path: string; chatId: string } | null;
    openInDiffView: (path: string, chatId: string) => void;
    consumeDiffFileJump: () => void;
    pendingChatMessage: { chatId: string; message: string } | null;
    setPendingChatMessage: (payload: { chatId: string; message: string } | null) => void;
  };

const getInitialSidebarState = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= MOBILE_BREAKPOINT;
};

const isDesktop = (): boolean =>
  typeof window !== 'undefined' && window.innerWidth >= MOBILE_BREAKPOINT;

// Mobile switches the sole view; desktop appends a tile to the mosaic
// unless the tile is already present.
function ensureTileVisible(
  set: (partial: Partial<UIStoreState>) => void,
  get: () => UIStoreState,
  tileId: MosaicTileId,
): void {
  if (!isDesktop()) {
    set({ currentView: tileIdToViewType(tileId), mosaicLayout: tileId });
    return;
  }
  const state = get();
  const layout = state.mosaicLayout;
  if (layout && isMosaicSplitNode(layout)) {
    if (!getLeaves(layout).includes(tileId)) {
      set({ mosaicLayout: { direction: 'row', first: layout, second: tileId } });
    }
    return;
  }
  const currentTile = getEffectiveLayout(layout, state.currentView);
  if (currentTile !== tileId) {
    set({ mosaicLayout: { direction: 'row', first: currentTile, second: tileId } });
  }
}

// The diff/editor jumps are chat-bound; a jump for a chat that's going away (its
// pane closed/replaced) is stale and would otherwise fire in the wrong tile.
function clearJumpsForChat(state: UIStoreState, chatId: string | null): Partial<UIStoreState> {
  const cleared: Partial<UIStoreState> = {};
  if (state.pendingDiffFile?.chatId === chatId) cleared.pendingDiffFile = null;
  if (state.pendingFilePath?.chatId === chatId) cleared.pendingFilePath = null;
  if (state.pendingFileJump?.chatId === chatId) cleared.pendingFileJump = null;
  return cleared;
}

// A pending jump can't survive its own tile being closed. Only the tile that
// would have claimed it clears it: a secondary tile owns jumps for the secondary
// chat, the primary owns the rest.
function clearJumpsForTile(state: UIStoreState, tileId: MosaicTileId): Partial<UIStoreState> {
  const view = tileIdToViewType(tileId);
  if (view !== 'diff' && view !== 'editor') return {};
  const owns = (jump: { chatId: string | undefined } | null) =>
    !!jump &&
    (isSecondaryTile(tileId)
      ? jump.chatId === state.secondaryChatId
      : jump.chatId !== state.secondaryChatId);
  const cleared: Partial<UIStoreState> = {};
  if (view === 'diff' && owns(state.pendingDiffFile)) cleared.pendingDiffFile = null;
  if (view === 'editor' && owns(state.pendingFilePath)) cleared.pendingFilePath = null;
  if (view === 'editor' && owns(state.pendingFileJump)) cleared.pendingFileJump = null;
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

      pendingFilePath: null,
      pendingFileJump: null,
      consumeFileJump: () => set({ pendingFileJump: null }),
      pendingDiffFile: null,
      consumeDiffFileJump: () => set({ pendingDiffFile: null }),
      openFileInEditor: (path, chatId, line) => {
        const secondary = chatId === get().secondaryChatId;
        set({
          pendingFilePath: { path, chatId },
          pendingFileJump:
            line != null
              ? { path, line, chatId, nonce: (get().pendingFileJump?.nonce ?? 0) + 1 }
              : null,
        });
        ensureTileVisible(set, get, viewTypeToTileId('editor', secondary));
      },
      openInDiffView: (path, chatId) => {
        const secondary = chatId === get().secondaryChatId;
        set({ pendingDiffFile: { path, chatId } });
        ensureTileVisible(set, get, viewTypeToTileId('diff', secondary));
      },

      currentView: 'agent',
      splitDirection: 'row',
      mosaicLayout: null,
      secondaryChatId: null,
      activeAgentTile: 'agent:primary',

      setActiveAgentTile: (tile) => {
        if (get().activeAgentTile !== tile) set({ activeAgentTile: tile });
      },

      toggleView: (view, toggle) => {
        const state = get();
        const layout = getEffectiveLayout(state.mosaicLayout, state.currentView);
        // Agent has no per-pane toggle: closing it tears down the split (or the
        // lone primary tile); opening it goes through the regular view click.
        if (view === 'agent') {
          if (toggle && getLeafViewTypes(layout).includes('agent')) {
            if (state.secondaryChatId) get().closeSplitChat();
            else get().removeTileFromMosaic('agent:primary');
          } else {
            get().handleViewClick('agent', true);
          }
          return;
        }
        // Mobile shows one view at a time and the switcher has no agent icon, so
        // re-tapping the active view returns to agent (removeTileFromMosaic can't
        // collapse a single-string layout).
        if (!isDesktop()) {
          get().handleViewClick(toggle && state.currentView === view ? 'agent' : view, false);
          return;
        }
        // Target the tile of the pane the user is in — falls back to the primary
        // tile when there's no secondary chat to scope to.
        const secondary = isSecondaryPaneActive(state.activeAgentTile, state.secondaryChatId);
        const tileId = viewTypeToTileId(view, secondary);
        if (toggle && getLeaves(layout).includes(tileId)) {
          get().removeTileFromMosaic(tileId);
        } else {
          ensureTileVisible(set, get, tileId);
        }
      },

      setCurrentView: (view) =>
        set({
          currentView: view,
          mosaicLayout: viewTypeToPrimaryTile(view),
          secondaryChatId: null,
        }),

      exitSplitMode: () => {
        const state = get();
        set({
          mosaicLayout: viewTypeToPrimaryTile(state.currentView),
          secondaryChatId: null,
        });
      },

      setSplitDirection: (direction) => set({ splitDirection: direction }),

      setMosaicLayout: (layout) => {
        if (layout === null) {
          set({ mosaicLayout: null });
          return;
        }
        if (typeof layout === 'string') {
          const leaf: MosaicTileId = layout === 'agent:secondary' ? 'agent:primary' : layout;
          set({
            mosaicLayout: leaf,
            currentView: tileIdToViewType(leaf),
            ...(layout === 'agent:secondary' ? { secondaryChatId: null } : {}),
          });
        } else {
          const leaves = getLeaves(layout);
          set({
            mosaicLayout: layout,
            currentView: tileIdToViewType(leaves[0]),
            ...(leaves.includes('agent:secondary') ? {} : { secondaryChatId: null }),
          });
        }
      },

      addTileToMosaic: (view, direction) => {
        const state = get();
        // Split controls used from the secondary pane open <view>:secondary.
        const secondary = isSecondaryPaneActive(state.activeAgentTile, state.secondaryChatId);
        const tileId = viewTypeToTileId(view, secondary);
        const currentLayout = getEffectiveLayout(state.mosaicLayout, state.currentView);

        if (getLeaves(currentLayout).includes(tileId)) return;

        set({
          mosaicLayout: {
            direction,
            first: currentLayout,
            second: tileId,
          },
        });
      },

      removeTileFromMosaic: (tileId) => {
        const state = get();
        const layout = state.mosaicLayout;
        if (!layout || typeof layout === 'string') return;
        const leaves = getLeaves(layout);
        if (!leaves.includes(tileId)) return;
        const clearedJumps = clearJumpsForTile(state, tileId);
        if (Object.keys(clearedJumps).length > 0) set(clearedJumps);
        const remaining = leaves.filter((v) => v !== tileId);
        if (remaining.length === 0) return;
        if (remaining.length === 1) {
          // A lone 'agent:secondary' is hoisted to 'agent:primary' so the
          // secondary slot is never occupied without a primary.
          const collapseTo: MosaicTileId =
            remaining[0] === 'agent:secondary' ? 'agent:primary' : remaining[0];
          const hadSecondary = leaves.includes('agent:secondary');
          set({
            currentView: tileIdToViewType(collapseTo),
            mosaicLayout: collapseTo,
            ...(hadSecondary ? { secondaryChatId: null } : {}),
          });
        } else {
          const newLayout = removeTileFromLayout(layout, tileId);
          if (newLayout) get().setMosaicLayout(newLayout);
        }
      },

      // Shift-click adds the view as a new tile in the mosaic (split mode);
      // regular click switches to it as the sole view.
      handleViewClick: (view, isShiftClick) => {
        const tileId = viewTypeToPrimaryTile(view);
        if (isShiftClick && isDesktop()) {
          get().addTileToMosaic(view, get().splitDirection);
        } else {
          set({
            currentView: view,
            mosaicLayout: tileId,
            secondaryChatId: null,
          });
        }
      },

      openChatInSplit: (chatId) => {
        const state = get();
        // When the secondary slot shows a different chat, default the active pane
        // back to primary and drop a jump still pending for the replaced chat.
        const secondaryChanged = state.secondaryChatId !== chatId;
        const resetForNewSecondary: Partial<UIStoreState> = secondaryChanged
          ? {
              activeAgentTile: 'agent:primary',
              ...clearJumpsForChat(state, state.secondaryChatId),
            }
          : {};
        if (!isDesktop()) {
          if (state.secondaryChatId === chatId) return;
          set({ secondaryChatId: chatId, ...resetForNewSecondary });
          return;
        }
        const nextLayout = buildSplitChatLayout(state.mosaicLayout);
        if (state.secondaryChatId === chatId && !nextLayout) return;
        set({
          secondaryChatId: chatId,
          ...(nextLayout ? { mosaicLayout: nextLayout } : {}),
          ...resetForNewSecondary,
        });
      },

      closeSplitChat: () => {
        const state = get();
        const layout = state.mosaicLayout;
        // Shared reset: focus back to primary, drop any jump aimed at the now-gone
        // secondary chat.
        const reset: Partial<UIStoreState> = {
          secondaryChatId: null,
          activeAgentTile: 'agent:primary',
          ...clearJumpsForChat(state, state.secondaryChatId),
        };
        if (layout && isMosaicSplitNode(layout)) {
          // Every secondary tile is scoped to the closing chat — drop them all.
          let newLayout: MosaicLayoutNode | null = layout;
          for (const tile of SECONDARY_TILE_IDS) {
            if (!newLayout) break;
            newLayout = removeTileFromLayout(newLayout, tile);
          }
          set({ ...reset, mosaicLayout: newLayout ?? 'agent:primary' });
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
        currentView: state.currentView,
        splitDirection: state.splitDirection,
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        secondaryChatId: state.secondaryChatId,
      }),
    },
  ),
);

// Returns a layout that includes both agent tiles, or null if `layout` already does.
function buildSplitChatLayout(
  layout: SplitViewState['mosaicLayout'],
): SplitViewState['mosaicLayout'] | null {
  if (!layout) {
    return { direction: 'row', first: 'agent:primary', second: 'agent:secondary' };
  }
  if (typeof layout === 'string') {
    if (layout === 'agent:primary') {
      return { direction: 'row', first: 'agent:primary', second: 'agent:secondary' };
    }
    return {
      direction: 'row',
      first: 'agent:primary',
      second: { direction: 'row', first: layout, second: 'agent:secondary' },
    };
  }
  const leaves = getLeaves(layout);
  const needsPrimary = !leaves.includes('agent:primary');
  const needsSecondary = !leaves.includes('agent:secondary');
  if (!needsPrimary && !needsSecondary) return null;
  let next = layout;
  if (needsPrimary) next = { direction: 'row', first: 'agent:primary', second: next };
  if (needsSecondary) next = { direction: 'row', first: next, second: 'agent:secondary' };
  return next;
}
