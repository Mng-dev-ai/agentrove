import { createContext } from 'react';
import type { Message, PermissionRequest } from '@/types/chat.types';
import type { ContextUsageInfo } from '@/components/chat/message-input/ContextUsageIndicator';

export interface ChatSessionState {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  isInitialLoading: boolean;
  pendingUserMessageId: string | null;
  attachedFiles: File[] | null;
  selectedModelId: string;
  contextUsage?: ContextUsageInfo;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  pendingPermissionRequest: PermissionRequest | null;
  isPermissionLoading: boolean;
  permissionError: string | null;
}

export interface ChatSessionActions {
  onSubmit: (e: React.FormEvent) => void;
  onStopStream: () => void;
  onCopy: (content: string, id: string) => void;
  onAttach: (files: File[]) => void;
  onModelChange: (modelId: string) => void;
  fetchNextPage: () => void;
  onPermissionApprove: (optionId: string) => void;
  onPermissionReject: (optionId: string) => void;
}

interface ChatSessionContextValue {
  state: ChatSessionState;
  actions: ChatSessionActions;
}

export const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);
export const ChatSessionStateContext = createContext<ChatSessionState | null>(null);
export const ChatSessionActionsContext = createContext<ChatSessionActions | null>(null);
