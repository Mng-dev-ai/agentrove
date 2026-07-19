import type { ComponentType } from 'react';
import type { Chat } from './chat.types';
import type { ToolAggregate } from './tools.types';

export type ToolComponent = ComponentType<{ tool: ToolAggregate; chatId?: string }>;

// Each theme rides a light or dark base (see DARK_PALETTES / useResolvedTheme)
export type Theme =
  | 'light'
  | 'dark'
  | 'system'
  | 'dim'
  | 'sepia'
  | 'solarized-light'
  | 'solarized-dark'
  | 'nord'
  | 'midnight'
  | 'dracula'
  | 'tokyo-night'
  | 'catppuccin-latte'
  | 'catppuccin-mocha'
  | 'ember'
  | 'gruvbox'
  | 'rose-pine'
  | 'rose-pine-dawn'
  | 'everforest'
  | 'kanagawa'
  | 'one-dark'
  | 'cyberpunk'
  | 'vercel'
  | 'github'
  | 'vscode-plus'
  | 'xcode'
  | 'raycast'
  | 'notion'
  | 'matrix'
  | 'linear'
  | 'lobster';
export type ResolvedTheme = 'light' | 'dark';
// Palette = Theme without `system`; for Monaco/xterm which can't read CSS vars.
export type Palette = Exclude<Theme, 'system'>;

type MentionType = 'file';

export interface MentionItem {
  type: MentionType;
  name: string;
  path: string;
  description?: string;
}

export interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export interface ModelSelectionState {
  modelByChat: Record<string, string>;
  favoriteModelIds: string[];
  selectModel: (chatId: string, modelId: string) => void;
  toggleFavoriteModel: (modelId: string) => void;
}

export type ViewType = 'agent' | 'diff' | 'editor' | 'terminal';

export const MAX_CHAT_PANES = 4;
export type SplitSlot = 1 | 2 | 3;

// Split tiles use :split-N; primary non-agent tiles stay bare (agent:primary is the exception).
export type AgentTileId = 'agent:primary' | `agent:split-${SplitSlot}`;
export type SplitTileId = `${ViewType}:split-${SplitSlot}`;
export type NonAgentTileId =
  | Exclude<ViewType, 'agent'>
  | Exclude<SplitTileId, `agent:split-${SplitSlot}`>;
export type TileId = AgentTileId | NonAgentTileId;

// 'row' = side by side; 'column' = stacked below.
export type SplitDirection = 'row' | 'column';

// Restored when the chat is revisited.
export interface WorkspaceLayout {
  openTabs: TileId[];
  visibleLayout: TileId[][];
}

export interface EditorPaneState {
  open: string[];
  selected: string | null;
}

export interface SplitViewState {
  // Always includes at least 'agent:primary'. Hidden open tiles stay mounted (editor/terminal state).
  openTabs: TileId[];
  // Rows of tiles (stack vertically; tiles in a row sit side by side). Always ≥1 tile.
  visibleLayout: TileId[][];
  // Chats in the three additional panes; primary is the route param.
  splitChatIds: string[];
  // Last-interacted agent pane — pane-scoped shortcuts (e.g. diff) target this chat.
  activeAgentTile: AgentTileId;
  // Exact last-touched pane (tab highlight). Unlike activeAgentTile, not just primary vs split slot.
  focusedTile: TileId | null;
  // Per-chat saved tabs; excludes split-chat tiles (rebuild effects restore those).
  layoutsByChat: Record<string, WorkspaceLayout>;
  // Per-chat editor tabs; EditorPane loses selection on unmount, so this is persisted.
  // Keyed by chat id (or landing-editor sentinel when no chat).
  editorByChat: Record<string, EditorPaneState>;
  // Which chat owns live openTabs/visibleLayout (save-on-switch).
  currentWorkspaceChatId: string | null;
}

export interface SplitViewActions {
  // Full-screen toggle for a view on the active agent pane.
  toggleView: (view: ViewType, toggle: boolean) => void;
  addViewToSplit: (view: ViewType, direction: SplitDirection) => void;
  removeTab: (tileId: TileId) => void;
  // Single agent view; tears down split chats (landing page).
  resetWorkspace: () => void;
  // Stash outgoing + restore incoming chat tabs (chat navigation).
  loadWorkspaceForChat: (chatId: string) => void;
  // Persist current tabs (leaving the chat page).
  stashWorkspace: () => void;
  openChatInSplit: (chatId: string) => void;
  rebuildSplitLayout: () => void;
  closeSplitChat: (chatId?: string) => void;
  activateTab: (tileId: TileId) => void;
  // Sets focusedTile + activeAgentTile so tab and pane clicks stay consistent.
  focusTile: (tileId: TileId) => void;
  // Drop deleted chat's workspace/editor/terminal state so localStorage doesn't grow forever.
  cleanupChat: (chatId: string) => void;
  cleanupAllChats: () => void;
}

export interface UIState {
  currentChat: Chat | null;
  // One-shot per chat; cleared after first send. PENDING_NEW_CHAT_KEY holds pre-create attaches.
  attachedFilesByChat: Record<string, File[]>;
  sidebarOpen: boolean;
  sidebarWidth: number;
}

export interface UIActions {
  setAttachedFilesForChat: (chatId: string, files: File[]) => void;
  clearAttachedFilesForChat: (chatId: string) => void;
  promoteAttachedFiles: (fromChatId: string, toChatId: string) => void;
  setCurrentChat: (chat: Chat | null) => void;
  setSidebarOpen: (isOpen: boolean) => void;
  setSidebarWidth: (width: number) => void;
}

// Prefixed with __ to guarantee no collision with real chat ids (UUIDs).
export const PENDING_NEW_CHAT_KEY = '__pending_new__';

export interface SlashCommand {
  value: string;
  label: string;
  description?: string;
}
