import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ThemeState,
  UIState,
  UIActions,
  SplitViewState,
  SplitViewActions,
  ViewType,
  MosaicTileId,
} from '@/types/ui.types';
import { MOBILE_BREAKPOINT } from '@/config/constants';
import {
  getLeaves,
  isMosaicSplitNode,
  removeTileFromLayout,
  tileIdToViewType,
  viewTypeToPrimaryTile,
} from '@/utils/mosaicHelpers';
import type { MenuMode } from '@/components/ui/commandRegistry';

type UIStoreState = ThemeState &
  Pick<UIState, 'sidebarOpen'> &
  Pick<UIActions, 'setSidebarOpen'> &
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
    pendingFilePath: string | null;
    // Nonce lets the consumer re-jump even when path+line repeat, so that clicking
    // the same search result after scrolling away still reveals it.
    pendingFileJump: { path: string; line: number; nonce: number } | null;
    openFileInEditor: (path: string, line?: number) => void;
    consumeFileJump: () => void;
    pendingDiffFile: string | null;
    openInDiffView: (path: string) => void;
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
// unless the view is already present.
function ensureViewVisible(
  set: (partial: Partial<UIStoreState>) => void,
  get: () => UIStoreState,
  view: ViewType,
): void {
  const tileId = viewTypeToPrimaryTile(view);
  if (!isDesktop()) {
    set({ currentView: view, mosaicLayout: tileId });
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
  const currentTile: MosaicTileId =
    typeof layout === 'string' ? layout : viewTypeToPrimaryTile(state.currentView);
  if (currentTile !== tileId) {
    set({ mosaicLayout: { direction: 'row', first: currentTile, second: tileId } });
  }
}

export const useUIStore = create<UIStoreState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      toggleTheme: () =>
        set((state) => {
          const next =
            state.theme === 'dark' ? 'light' : state.theme === 'light' ? 'system' : 'dark';
          return { theme: next };
        }),
      setTheme: (theme) => set({ theme }),
      sidebarOpen: getInitialSidebarState(),
      setSidebarOpen: (isOpen) => set({ sidebarOpen: isOpen }),

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
      openFileInEditor: (path, line) => {
        set({
          pendingFilePath: path,
          pendingFileJump:
            line != null ? { path, line, nonce: (get().pendingFileJump?.nonce ?? 0) + 1 } : null,
        });
        ensureViewVisible(set, get, 'editor');
      },
      openInDiffView: (path) => {
        set({ pendingDiffFile: path });
        ensureViewVisible(set, get, 'diff');
      },

      currentView: 'agent',
      splitDirection: 'row',
      mosaicLayout: null,
      secondaryChatId: null,

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
        const tileId = viewTypeToPrimaryTile(view);
        const state = get();
        const currentLayout = state.mosaicLayout ?? viewTypeToPrimaryTile(state.currentView);

        const leaves: MosaicTileId[] =
          typeof currentLayout === 'string' ? [currentLayout] : getLeaves(currentLayout);
        if (leaves.includes(tileId)) return;

        set({
          mosaicLayout: {
            direction,
            first: currentLayout,
            second: tileId,
          },
        });
      },

      removeTileFromMosaic: (tileId) => {
        const layout = get().mosaicLayout;
        if (!layout || typeof layout === 'string') return;
        const leaves = getLeaves(layout);
        if (!leaves.includes(tileId)) return;
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
        if (!isDesktop()) {
          if (state.secondaryChatId === chatId) return;
          set({ secondaryChatId: chatId });
          return;
        }
        const nextLayout = buildSplitChatLayout(state.mosaicLayout);
        if (state.secondaryChatId === chatId && !nextLayout) return;
        set({
          secondaryChatId: chatId,
          ...(nextLayout ? { mosaicLayout: nextLayout } : {}),
        });
      },

      closeSplitChat: () => {
        const state = get();
        const layout = state.mosaicLayout;
        if (layout && isMosaicSplitNode(layout)) {
          const newLayout = removeTileFromLayout(layout, 'agent:secondary');
          set({
            secondaryChatId: null,
            mosaicLayout: newLayout ?? 'agent:primary',
          });
        } else if (state.secondaryChatId !== null) {
          set({ secondaryChatId: null });
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
      version: 7,
      partialize: (state) => ({
        theme: state.theme,
        currentView: state.currentView,
        splitDirection: state.splitDirection,
        sidebarOpen: state.sidebarOpen,
        secondaryChatId: state.secondaryChatId,
      }),
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        delete state.isSplitMode;
        delete state.secondaryView;
        delete state.permissionMode;
        delete state.thinkingMode;
        // v7: mosaic leaves changed from ViewType to MosaicTileId. We don't
        // persist mosaicLayout anyway, so just drop any stale shape.
        delete state.mosaicLayout;
        if (state.splitDirection === 'horizontal') state.splitDirection = 'row';
        if (state.splitDirection === 'vertical') state.splitDirection = 'column';
        if (version < 7) state.secondaryChatId = null;
        return state;
      },
      merge: (persisted, current) => ({
        ...current,
        ...(persisted || {}),
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
