import type { Chat } from './chat.types';
import type { ToolAggregate } from './tools.types';

export type ToolComponent = React.FC<{ tool: ToolAggregate; chatId?: string }>;

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

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

export type ViewType = 'agent' | 'diff' | 'editor' | 'prReview' | 'terminal' | 'secrets';

// Mosaic leaves used to be ViewType strings, but to render two `agent` panes
// simultaneously (split chat view) the agent slot needs to be disambiguated.
// Non-agent tile ids are identical to their ViewType.
export type AgentTileId = 'agent:primary' | 'agent:secondary';
export type NonAgentTileId = Exclude<ViewType, 'agent'>;
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
