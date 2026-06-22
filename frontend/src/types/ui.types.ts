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
  | 'catppuccin-latte';
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

// Mosaic leaves used to be ViewType strings, but split-chat view renders two
// panes scoped to different chats, so every view has a `:secondary` variant
// disambiguating the second chat. Primary tile ids match their ViewType (the
// agent slot is the one exception: 'agent:primary').
export type AgentTileId = 'agent:primary' | 'agent:secondary';
export type SecondaryTileId = `${ViewType}:secondary`;
export type NonAgentTileId =
  | Exclude<ViewType, 'agent'>
  | Exclude<SecondaryTileId, 'agent:secondary'>;
export type MosaicTileId = AgentTileId | NonAgentTileId;

export type MosaicDirection = 'row' | 'column';

export interface MosaicSplitNode {
  direction: MosaicDirection;
  first: MosaicLayoutNode;
  second: MosaicLayoutNode;
  splitPercentages?: number[];
}

export type MosaicLayoutNode = MosaicSplitNode | MosaicTileId;

export interface SplitViewState {
  currentView: ViewType;
  splitDirection: MosaicDirection;
  mosaicLayout: MosaicLayoutNode | null;
  // Secondary chat for split-chat view. Primary chat is always the route param.
  secondaryChatId: string | null;
  // The agent pane the user last interacted with — targets pane-scoped actions
  // (e.g. the diff shortcut) at the chat the user is actually in.
  activeAgentTile: AgentTileId;
}

export interface SplitViewActions {
  setCurrentView: (view: ViewType) => void;
  exitSplitMode: () => void;
  handleViewClick: (view: ViewType, isShiftClick: boolean) => void;
  setSplitDirection: (direction: MosaicDirection) => void;
  setMosaicLayout: (layout: MosaicLayoutNode | null) => void;
  addTileToMosaic: (view: ViewType, direction: MosaicDirection) => void;
  removeTileFromMosaic: (tileId: MosaicTileId) => void;
  openChatInSplit: (chatId: string) => void;
  closeSplitChat: () => void;
  // Returns the chatId that should become the new route primary (caller navigates).
  swapChatPanes: (currentPrimaryChatId: string) => string | null;
  setActiveAgentTile: (tile: AgentTileId) => void;
  // Opens or (when toggling) closes a view's tile for the active agent pane,
  // so the shortcut targets the chat the user is currently in.
  toggleView: (view: ViewType, toggle: boolean) => void;
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
