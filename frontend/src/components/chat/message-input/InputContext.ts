import { createContext, type RefObject } from 'react';
import type { MentionItem, SlashCommand } from '@/types/ui.types';
import type { EditorCodeSelection } from '@/store/uiStore';
import type { ContextUsageInfo } from './ContextUsageIndicator';

export interface InputState {
  message: string;
  cursorPosition: number;
  isLoading: boolean;
  isDisabled: boolean;
  isStreaming: boolean;
  isEnhancing: boolean;
  hasMessage: boolean;
  hasContent: boolean;
  hasAttachments: boolean;
  showPreview: boolean;
  showFileUpload: boolean;
  showDrawingModal: boolean;
  showLoadingSpinner: boolean;
  showTip: boolean;
  isDragging: boolean;
  compact: boolean;
  placeholder: string;
  selectedModelId: string;
  dropdownPosition: 'top' | 'bottom';
  attachedFiles: File[] | null;
  attachedSelections: EditorCodeSelection[];
  previewUrls: string[];
  editingImageIndex: number | null;
  contextUsage?: ContextUsageInfo;
  chatId?: string;
  isMentionActive: boolean;
  slashCommandSuggestions: SlashCommand[];
  highlightedSlashCommandIndex: number;
  filteredFiles: MentionItem[];
  highlightedMentionIndex: number;
}

export interface InputActions {
  setMessage: (value: string) => void;
  setCursorPosition: (pos: number) => void;
  setShowFileUpload: (v: boolean) => void;
  onModelChange: (modelId: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  submitOrStop: () => void;
  handleKeyDown: (e: React.KeyboardEvent<Element>) => void;
  handleSendClick: (e: React.MouseEvent) => void;
  handleEnhancePrompt: () => void;
  handleFileSelect: (files: File[]) => void;
  handleRemoveFile: (index: number) => void;
  handleRemoveSelection: (index: number) => void;
  handleDrawClick: (index: number) => void;
  handleDrawingSave: (dataUrl: string) => Promise<void>;
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  closeDrawingModal: () => void;
  resetDragState: () => void;
  selectSlashCommand: (command: SlashCommand) => void;
  selectMention: (item: MentionItem) => void;
}

export interface InputMeta {
  formRef: RefObject<HTMLFormElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  dragHandlers: Record<string, (e: React.DragEvent) => void>;
}

export interface InputContextValue {
  state: InputState;
  actions: InputActions;
  meta: InputMeta;
}

export const InputContext = createContext<InputContextValue | null>(null);
export const InputStateContext = createContext<InputState | null>(null);
export const InputActionsContext = createContext<InputActions | null>(null);
