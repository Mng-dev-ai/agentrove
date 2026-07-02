import type { Chat } from './chat.types';
import type { ToolAggregate } from './tools.types';

export type ToolComponent = React.FC<{ tool: ToolAggregate; chatId?: string }>;

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
  | 'ember';
export type ResolvedTheme = 'light' | 'dark';
// Active palette with `system` resolved away — used where concrete per-theme colors
// are built outside CSS (Monaco/xterm can't read CSS vars). Theme = Palette | 'system'.
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

export type ViewType = 'agent' | 'diff' | 'editor' | 'terminal' | 'secrets';

// A tile id used to be a bare ViewType string, but split-chat view renders two
// panes scoped to different chats, so every view has a `:secondary` variant
// disambiguating the second chat. Primary tile ids match their ViewType (the
// agent slot is the one exception: 'agent:primary').
export type AgentTileId = 'agent:primary' | 'agent:secondary';
export type SecondaryTileId = `${ViewType}:secondary`;
export type NonAgentTileId =
  | Exclude<ViewType, 'agent'>
  | Exclude<SecondaryTileId, 'agent:secondary'>;
export type TileId = AgentTileId | NonAgentTileId;

// The axis a single split adds along: 'row' = side by side (split right),
// 'column' = stacked below (split bottom).
export type SplitDirection = 'row' | 'column';

// A chat's saved workspace tabs — what's restored when the chat is revisited.
export interface WorkspaceLayout {
  openTabs: TileId[];
  visibleLayout: TileId[][];
}

// Per-chat editor pane state: the open file tabs (in strip order) and the active one.
export interface EditorPaneState {
  open: string[];
  selected: string | null;
}

export interface SplitViewState {
  // Every open tab, in strip order. Always holds at least 'agent:primary'.
  openTabs: TileId[];
  // The on-screen layout as rows of tiles: rows stack vertically, tiles within a
  // row sit side by side. [[A]] = full view; [[A, B]] = side by side; [[A], [B]]
  // = stacked; [[A, B], [C]] = A│B over C. Background tabs (open but not visible)
  // stay mounted off-screen. Always holds at least one tile.
  visibleLayout: TileId[][];
  // Secondary chat for split-chat view. Primary chat is always the route param.
  secondaryChatId: string | null;
  // The agent pane the user last interacted with — targets pane-scoped actions
  // (e.g. the diff shortcut) at the chat the user is actually in.
  activeAgentTile: AgentTileId;
  // The exact pane the user last touched — drives the focused-tab highlight.
  // Distinct from activeAgentTile, which only tracks the active chat (primary vs
  // secondary), not the specific tile.
  focusedTile: TileId | null;
  // Saved tabs per chat, so each chat restores its own workspace when revisited.
  // Excludes split-chat (:secondary) tiles, which the split effects rebuild.
  layoutsByChat: Record<string, WorkspaceLayout>;
  // The open file tabs + active file in each chat's editor — restored when revisiting
  // a chat (EditorPane's selection is lost on unmount) and persisted so a page refresh
  // reopens them. Keyed by chat id (or a landing-editor sentinel for the chat-less
  // landing page).
  editorByChat: Record<string, EditorPaneState>;
  // Which chat the live openTabs/visibleLayout belong to — drives save-on-switch.
  currentWorkspaceChatId: string | null;
}

export interface SplitViewActions {
  // Opens a view as a full tab, or — when toggling — closes it if already open.
  // Scoped to the active agent pane so shortcuts hit the chat the user is in.
  toggleView: (view: ViewType, toggle: boolean) => void;
  // Opens a view (if needed) and adds it to the on-screen layout: 'row' beside
  // the last row, 'column' as a new row below.
  addViewToSplit: (view: ViewType, direction: SplitDirection) => void;
  // Closes a tab, dropping it from the open and visible sets.
  removeTab: (tileId: TileId) => void;
  // Resets the workspace to a single agent view and tears down any split chat
  // (used by the landing page). Detaches the live layout from any chat.
  resetWorkspace: () => void;
  // Saves the outgoing chat's tabs and restores the incoming chat's (defaulting
  // to a lone agent view). Called on chat navigation.
  loadWorkspaceForChat: (chatId: string) => void;
  // Saves the current chat's tabs in place — used when leaving the chat page.
  stashWorkspace: () => void;
  openChatInSplit: (chatId: string) => void;
  closeSplitChat: () => void;
  // Returns the chatId that should become the new route primary (caller navigates).
  swapChatPanes: (currentPrimaryChatId: string) => string | null;
  // Shows a tile full (sole visible pane) and focuses it — the default tab click.
  activateTab: (tileId: TileId) => void;
  // Adds a tile to the on-screen layout, keeping the rest visible: 'row' appends
  // it to the last row (side by side), 'column' starts a new row below.
  splitView: (direction: SplitDirection, tileId: TileId) => void;
  // Single focus path: records the exact pane (highlights its tab) and scopes the
  // active chat (primary/secondary) from the tile, so tab and pane clicks agree.
  focusTile: (tileId: TileId) => void;
  // Drops a deleted chat's saved workspace tabs, editor tabs, and terminal tab
  // layout so per-chat state doesn't accumulate in localStorage forever.
  cleanupChat: (chatId: string) => void;
  cleanupAllChats: () => void;
}

export interface UIState {
  currentChat: Chat | null;
  // Per-chat one-shot attachments. Cleared after the first message for that
  // chat ships. The PENDING_NEW_CHAT_KEY sentinel holds files attached before
  // the chat id exists; landing page promotes them once the chat is created.
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
