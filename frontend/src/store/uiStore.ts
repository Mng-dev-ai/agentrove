import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Theme,
  ThemeState,
  UIState,
  UIActions,
  SplitViewState,
  SplitViewActions,
  TileId,
  AgentTileId,
  SplitSlot,
  WorkspaceLayout,
  LastThread,
} from '@/types/ui.types';
import { MAX_CHAT_PANES } from '@/types/ui.types';
import type { DiffMode } from '@/types/sandbox.types';
import type { Chat } from '@/types/chat.types';
import type { Channel } from '@/types/channel.types';
import { MOBILE_BREAKPOINT } from '@/config/constants';
import {
  activeSplitSlot,
  agentTileFor,
  isSplitTile,
  splitAgentTile,
  splitSlotOfTile,
  tileIdToViewType,
  viewTypeToTileId,
} from '@/utils/tileHelpers';
import { clearTerminalStorage } from '@/utils/terminal';
import type { MenuMode } from '@/components/ui/command-menu/commandRegistry';
import {
  EMPTY_SIDEBAR_FILTERS,
  type SidebarActivityKind,
  type SidebarFilters,
} from '@/store/sidebarFilters';
import { THEME_CYCLE } from '@/utils/theme';

const SIDEBAR_SECTIONS = ['pinned', 'recents'] as const;
export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 560;
export const DEFAULT_SIDEBAR_WIDTH = 300;

export const clampSidebarWidth = (width: number): number =>
  Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width)));

export interface ForeignFileTarget {
  kind: 'foreign';
  path: string;
  relPath: string;
  workspaceName: string;
  workspaceRoot: string;
  sandboxId: string;
}

export type FileOpenTarget = { kind: 'local'; path: string } | ForeignFileTarget;

interface PendingFileOpen {
  target: FileOpenTarget;
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

export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number];

export type MenuPosition = { top: number } & ({ left: number } | { right: number });

export interface ChatMenu {
  chat: Chat;
  position: MenuPosition;
  source: 'sidebar' | 'pane';
}

export interface ChannelMenu {
  channel: Channel;
  position: MenuPosition;
  source: 'sidebar' | 'title';
}

type UIStoreState = ThemeState &
  Pick<UIState, 'sidebarOpen' | 'sidebarWidth'> &
  Pick<UIActions, 'setSidebarOpen' | 'setSidebarWidth'> &
  SplitViewState &
  SplitViewActions & {
    // Persisted so reload keeps the narrowed sidebar view.
    sidebarFilters: SidebarFilters;
    setSidebarFilters: (filters: SidebarFilters) => void;
    sidebarActivityView: SidebarActivityKind | null;
    setSidebarActivityView: (view: SidebarActivityKind | null) => void;
    collapsedSidebarSections: SidebarSection[];
    toggleSidebarSection: (section: SidebarSection) => void;
    lastThread: LastThread | null;
    setLastThread: (thread: LastThread) => void;
    chatMenu: ChatMenu | null;
    setChatMenu: (menu: ChatMenu | null) => void;
    toggleChatMenu: (menu: ChatMenu) => void;
    channelMenu: ChannelMenu | null;
    setChannelMenu: (menu: ChannelMenu | null) => void;
    toggleChannelMenu: (menu: ChannelMenu) => void;
    commandMenuOpen: boolean;
    setCommandMenuOpen: (open: boolean) => void;
    // Mode-switch commands set this; CommandMenu consumes it on next open.
    pendingMenuMode: MenuMode | null;
    setPendingMenuMode: (mode: MenuMode | null) => void;
    subThreadDialogOpen: boolean;
    setSubThreadDialogOpen: (open: boolean) => void;
    // Desktop preference (persisted); phones use the transient mobileSessionPanelOpen.
    sessionPanelOpen: boolean;
    // Split panes' open panels, keyed by chat so the state follows a chat across slots.
    splitSessionPanelChatIds: string[];
    mobileSessionPanelOpen: boolean;
    toggleSessionPanel: (agentTile?: AgentTileId) => void;
    closeMobileSessionPanel: () => void;
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
    openFileInEditor: (
      target: string | ForeignFileTarget,
      chatId: string | undefined,
      line?: number,
      split?: boolean,
    ) => void;
    // Diff tab to select when that chat's diff view next renders.
    pendingDiffMode: { chatId: string; mode: DiffMode } | null;
    diffStyle: 'unified' | 'split';
    setDiffStyle: (style: 'unified' | 'split') => void;
    pendingChatMessage: { chatId: string; message: string } | null;
    setPendingChatMessage: (payload: { chatId: string; message: string } | null) => void;
    // Selection chips for a chat's input; serialized into the prompt at send.
    composerSelectionsByChat: Record<string, ComposerSelection[]>;
    addComposerSelection: (chatId: string, selection: ComposerSelection) => void;
    removeComposerSelection: (chatId: string, index: number) => void;
    clearComposerSelections: (chatId: string) => void;
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

function splitSlotAt(index: number): SplitSlot {
  if (index === 0) return 1;
  if (index === 1) return 2;
  return 3;
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

function insertBeside(layout: TileId[][], anchor: TileId, tileId: TileId): TileId[][] {
  if (!layout.flat().includes(anchor)) return appendToLastRow(layout, tileId);
  return layout.map((row) => row.flatMap((tile) => (tile === anchor ? [tile, tileId] : [tile])));
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

function promotedTile(tileId: TileId): TileId | null {
  const slot = splitSlotOfTile(tileId);
  if (!slot) return null;
  if (slot === 1) return viewTypeToTileId(tileIdToViewType(tileId), null);
  return compactTileAfter(tileId, 1);
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

type SessionPanelState = Pick<
  UIStoreState,
  'sessionPanelOpen' | 'splitSessionPanelChatIds' | 'splitChatIds'
>;

export function selectAppliedTheme(state: ThemeState): Theme {
  return state.themePreview ?? state.theme;
}

export function sessionPanelOpenFor(state: SessionPanelState, agentTile: AgentTileId): boolean {
  const slot = splitSlotOfTile(agentTile);
  if (!slot) return state.sessionPanelOpen;
  const chatId = state.splitChatIds[slot - 1];
  return !!chatId && state.splitSessionPanelChatIds.includes(chatId);
}

export function openSessionPanelTiles(state: SessionPanelState): AgentTileId[] {
  const agentTiles: AgentTileId[] = [
    'agent:primary',
    ...state.splitChatIds.map((_, index) => splitAgentTile(splitSlotAt(index))),
  ];
  return agentTiles.filter((agentTile) => sessionPanelOpenFor(state, agentTile));
}

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
      themePreview: null,
      setThemePreview: (themePreview) => set({ themePreview }),
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
      sidebarActivityView: null,
      setSidebarActivityView: (view) => set({ sidebarActivityView: view }),
      lastThread: null,
      setLastThread: (lastThread) => set({ lastThread }),
      collapsedSidebarSections: [],
      toggleSidebarSection: (section) =>
        set((state) => ({
          collapsedSidebarSections: state.collapsedSidebarSections.includes(section)
            ? state.collapsedSidebarSections.filter((s) => s !== section)
            : [...state.collapsedSidebarSections, section],
        })),

      chatMenu: null,
      setChatMenu: (chatMenu) => set({ chatMenu }),
      toggleChatMenu: (menu) => {
        const open = get().chatMenu;
        const same = open?.source === menu.source && open.chat.id === menu.chat.id;
        set({ chatMenu: same ? null : menu });
      },
      channelMenu: null,
      setChannelMenu: (channelMenu) => set({ channelMenu }),
      toggleChannelMenu: (menu) => {
        const open = get().channelMenu;
        const same = open?.source === menu.source && open.channel.id === menu.channel.id;
        set({ channelMenu: same ? null : menu });
      },
      commandMenuOpen: false,
      setCommandMenuOpen: (open) => set({ commandMenuOpen: open }),
      pendingMenuMode: null,
      setPendingMenuMode: (mode) => set({ pendingMenuMode: mode }),
      subThreadDialogOpen: false,
      setSubThreadDialogOpen: (open) => set({ subThreadDialogOpen: open }),
      sessionPanelOpen: getInitialSidebarState(),
      splitSessionPanelChatIds: [],
      mobileSessionPanelOpen: false,
      toggleSessionPanel: (agentTile = get().activeAgentTile) => {
        if (isDesktop()) {
          const state = get();
          const open = !sessionPanelOpenFor(state, agentTile);
          const slot = splitSlotOfTile(agentTile);
          if (slot) {
            const chatId = state.splitChatIds[slot - 1];
            if (!chatId) return;
            set({
              splitSessionPanelChatIds: open
                ? [...state.splitSessionPanelChatIds, chatId]
                : state.splitSessionPanelChatIds.filter((id) => id !== chatId),
            });
          } else {
            set({ sessionPanelOpen: open });
          }
          if (open) get().focusTile(agentTile);
          return;
        }
        if (get().mobileSessionPanelOpen) {
          set({ mobileSessionPanelOpen: false });
          return;
        }
        // The panel describes the routed chat, so its actions target the primary pane.
        get().activateTab('agent:primary');
        set({ mobileSessionPanelOpen: true });
      },
      closeMobileSessionPanel: () => set({ mobileSessionPanelOpen: false }),
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
      pendingDiffMode: null,
      diffStyle: 'unified',
      setDiffStyle: (diffStyle) => set({ diffStyle }),
      openFileInEditor: (target, chatId, line, split = false) => {
        const state = get();
        const splitIndex = chatId ? state.splitChatIds.indexOf(chatId) : -1;
        const slot = splitIndex >= 0 ? splitSlotAt(splitIndex) : null;
        const tileId = viewTypeToTileId('editor', slot);
        const nonce = state.fileOpenNonce + 1;
        set({
          fileOpenNonce: nonce,
          pendingFileOpen: {
            target: typeof target === 'string' ? { kind: 'local', path: target } : target,
            chatId,
            nonce,
            ...(line != null ? { line } : {}),
          },
          openTabs: state.openTabs.includes(tileId) ? state.openTabs : [...state.openTabs, tileId],
        });
        // Already visible — focus only; activateTab would collapse a split.
        if (state.visibleLayout.flat().includes(tileId)) {
          get().focusTile(tileId);
        } else if (split && isDesktop()) {
          set({ visibleLayout: appendToLastRow(state.visibleLayout, tileId) });
          get().focusTile(tileId);
        } else {
          get().activateTab(tileId);
        }
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
          mobileSessionPanelOpen: false,
        });
      },

      focusTile: (tileId) => {
        if (get().focusedTile === tileId) return;
        // activeAgentTile is always-defined coarsening of nullable focusedTile.
        set({
          focusedTile: tileId,
          activeAgentTile: agentTileFor(tileId),
          mobileSessionPanelOpen: false,
        });
      },

      toggleView: (view, toggle, agentTile = get().activeAgentTile) => {
        const state = get();
        // Agent is never torn down; toggle closes split or re-focuses primary.
        if (view === 'agent') {
          if (toggle && state.splitChatIds.length > 0) get().closeSplitChat();
          else get().activateTab('agent:primary');
          return;
        }
        const slot = activeSplitSlot(agentTile, state.splitChatIds);
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
            mobileSessionPanelOpen: false,
          });
          return;
        }
        if (state.splitChatIds.length > 0) {
          const visible = state.visibleLayout.flat().includes(tileId);
          if (visible && toggle) {
            get().removeTab(tileId);
          } else if (visible) {
            get().focusTile(tileId);
          } else {
            set({
              openTabs: state.openTabs.includes(tileId)
                ? state.openTabs
                : [...state.openTabs, tileId],
              visibleLayout: insertBeside(state.visibleLayout, agentTileFor(tileId), tileId),
              focusedTile: tileId,
              activeAgentTile: agentTileFor(tileId),
            });
          }
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

      addViewToSplit: (view, direction, agentTile = get().activeAgentTile) => {
        const state = get();
        const slot = activeSplitSlot(agentTile, state.splitChatIds);
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
          const owner = agentTileFor(tileId);
          const next = visibleLayout.flat().includes(owner)
            ? owner
            : lastVisibleTile(visibleLayout);
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
          splitSessionPanelChatIds: [],
          activeAgentTile: 'agent:primary',
          focusedTile: null,
          currentWorkspaceChatId: null,
        }),

      loadWorkspaceForChat: (chatId) => {
        // Before loading so same-chat rehydrate still keeps the title tab.
        get().openChatTab(chatId);
        get().loadWorkspace(chatId);
      },

      loadWorkspace: (workspaceId) => {
        const state = get();
        if (state.currentWorkspaceChatId === workspaceId) return;
        const layoutsByChat = { ...state.layoutsByChat };
        if (state.currentWorkspaceChatId) {
          layoutsByChat[state.currentWorkspaceChatId] = ownTabs(
            state.openTabs,
            state.visibleLayout,
          );
        }
        const restored = layoutsByChat[workspaceId] ?? {
          openTabs: ['agent:primary'],
          visibleLayout: [['agent:primary']],
        };
        set({
          layoutsByChat,
          currentWorkspaceChatId: workspaceId,
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

      cleanupChats: (isForgotten) => {
        const { currentWorkspaceChatId, splitChatIds } = get();
        // Reset detaches the live layout so a later load can't re-stash the deleted chat.
        if (currentWorkspaceChatId && isForgotten(currentWorkspaceChatId)) {
          get().resetWorkspace();
        } else {
          for (const chatId of splitChatIds) {
            if (isForgotten(chatId)) get().closeSplitChat(chatId);
          }
        }
        const state = get();
        set({
          editorByChat: Object.fromEntries(
            Object.entries(state.editorByChat).filter(([id]) => !isForgotten(id)),
          ),
          layoutsByChat: Object.fromEntries(
            Object.entries(state.layoutsByChat).filter(([id]) => !isForgotten(id)),
          ),
          chatTabs: state.chatTabs.filter((id) => !isForgotten(id)),
          splitSessionPanelChatIds: state.splitSessionPanelChatIds.filter((id) => !isForgotten(id)),
          lastThread:
            state.lastThread && isForgotten(state.lastThread.id) ? null : state.lastThread,
        });
        clearTerminalStorage(isForgotten);
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

      openSideQuestion: (chatId, askingChatId) => {
        const { splitChatIds } = get();
        if (!splitChatIds.includes(chatId) && splitChatIds.length >= MAX_CHAT_PANES - 1) {
          const evictable = splitChatIds.filter((id) => id !== askingChatId);
          get().closeSplitChat(evictable[evictable.length - 1]);
        }
        get().openChatInSplit(chatId);
        if (isDesktop()) return;
        const state = get();
        set(rebuildSplitGrid(state, state.splitChatIds));
        get().focusTile(splitAgentTile(splitSlotAt(state.splitChatIds.indexOf(chatId))));
      },

      rebuildSplitLayout: () => {
        const state = get();
        if (state.splitChatIds.length === 0) return;
        const grid = rebuildSplitGrid(state, state.splitChatIds);
        // A restored workspace is stored without split tiles; keep its own tiles beside their neighbours.
        const ownTiles = state.visibleLayout.flat().filter((tile) => !isSplitTile(tile));
        let visibleLayout = grid.visibleLayout;
        ownTiles.forEach((tile, i) => {
          if (visibleLayout.flat().includes(tile)) return;
          visibleLayout = insertBeside(visibleLayout, ownTiles[i - 1] ?? 'agent:primary', tile);
        });
        set({ ...grid, visibleLayout });
      },

      promoteFirstSplit: () => {
        const state = get();
        const closedChatId = state.currentWorkspaceChatId;
        const [promotedChatId, ...splitChatIds] = state.splitChatIds;
        if (!closedChatId || !promotedChatId) return;
        const openTabs = state.openTabs.map(promotedTile).filter((tile) => tile !== null);
        let visibleLayout = state.visibleLayout
          .map((row) => row.map(promotedTile).filter((tile) => tile !== null))
          .filter((row) => row.length > 0);
        if (visibleLayout.length === 0) visibleLayout = agentGridFor(1 + splitChatIds.length);
        set({
          layoutsByChat: {
            ...state.layoutsByChat,
            [closedChatId]: ownTabs(state.openTabs, state.visibleLayout),
          },
          currentWorkspaceChatId: promotedChatId,
          splitChatIds,
          sessionPanelOpen: state.splitSessionPanelChatIds.includes(promotedChatId),
          splitSessionPanelChatIds: state.splitSessionPanelChatIds.filter(
            (id) => id !== promotedChatId,
          ),
          openTabs,
          visibleLayout,
          focusedTile: state.focusedTile ? promotedTile(state.focusedTile) : null,
          activeAgentTile: agentTileFor(promotedTile(state.activeAgentTile) ?? 'agent:primary'),
          ...clearJumpsForChat(state, closedChatId),
        });
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
            splitSessionPanelChatIds: [],
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
          focusedTile = isDesktop() ? lastVisibleTile(visibleLayout) : 'agent:primary';
          activeAgentTile = agentTileFor(focusedTile);
        }
        set({
          splitChatIds,
          splitSessionPanelChatIds: state.splitSessionPanelChatIds.filter((id) => id !== chatId),
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
        sessionPanelOpen: state.sessionPanelOpen,
        diffStyle: state.diffStyle,
        // Status filters are session-only (empty at mount) — don't persist them.
        sidebarFilters: { ...state.sidebarFilters, statuses: [] },
        collapsedSidebarSections: state.collapsedSidebarSections,
        lastThread: state.lastThread,
        splitChatIds: state.splitChatIds,
        splitSessionPanelChatIds: state.splitSessionPanelChatIds,
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
          // Stored state can name sections the sidebar no longer has
          collapsedSidebarSections: ((stored?.collapsedSidebarSections ?? []) as string[]).filter(
            (section): section is SidebarSection =>
              (SIDEBAR_SECTIONS as readonly string[]).includes(section),
          ),
        };
      },
    },
  ),
);
