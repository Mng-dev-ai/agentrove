import { apiClient, StreamResponse } from '@/lib/api';
import { ensureResponse, serviceCall, buildQueryString } from '@/services/base/BaseService';
import { authService } from '@/services/authService';
import { validateRequired, validateId } from '@/utils/validation';
import { chatStorage } from '@/utils/storage';
import type {
  ChatRequest,
  Chat,
  ChatSearchResponse,
  CreateChatRequest,
  ContextUsage,
} from '@/types/chat.types';
import type { ChangedFilesData, FileDiffData, GitCommitResult } from '@/types/sandbox.types';
import type { CursorPaginationParams, PaginatedChats, PaginatedMessages } from '@/types/api.types';

export function buildChatFormData(request: ChatRequest): FormData {
  // Single encoding of the /chat/chat multipart contract — shared with
  // cloudChatService so new fields can't silently drift between local and cloud.
  const formData = new FormData();
  formData.append('prompt', request.prompt);

  if (request.chat_id) {
    formData.append('chat_id', request.chat_id);
  }
  if (request.model_id) {
    formData.append('model_id', request.model_id);
  }
  if (request.attached_files && request.attached_files.length > 0) {
    request.attached_files.forEach((file) => {
      formData.append('attached_files', file);
    });
  }
  if (request.thinking_mode) {
    formData.append('thinking_mode', request.thinking_mode);
  }
  if (request.worktree) {
    formData.append('worktree', 'true');
  }
  if (request.plan_mode) {
    formData.append('plan_mode', 'true');
  }
  formData.append('selected_persona_name', request.selected_persona_name);
  formData.append('permission_mode', request.permission_mode);
  return formData;
}

async function createCompletion(
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<StreamResponse> {
  validateRequired(request.prompt, 'Prompt');

  return serviceCall(
    async () => {
      const formData = buildChatFormData(request);

      const taskResponse = await apiClient.postForm<{
        chat_id: string;
        message_id: string;
        last_seq?: number;
        checkpoint_id: string | null;
      }>('/chat/chat', formData, signal);

      const payload = ensureResponse(taskResponse, 'Failed to start chat completion');
      const eventSource = createEventSource(payload.chat_id, signal, payload.last_seq);

      return {
        source: eventSource,
        messageId: payload.message_id,
        checkpointId: payload.checkpoint_id,
      };
    },
    { signal },
  );
}

async function checkChatStatus(chatId: string): Promise<{
  has_active_task: boolean;
  message_id?: string;
  stream_id?: string;
  last_seq?: number;
} | null> {
  return serviceCall(() => apiClient.get(`/chat/chats/${chatId}/status`));
}

async function reconnectToStream(
  chatId: string,
  messageId: string,
  signal?: AbortSignal,
  afterSeq?: number,
): Promise<{
  source: EventSource;
  messageId: string;
}> {
  const eventSource = createEventSource(chatId, signal, afterSeq);

  return {
    source: eventSource,
    messageId,
  };
}

async function stopStream(chatId: string): Promise<void> {
  await serviceCall(async () => {
    await apiClient.delete(`/chat/chats/${chatId}/stream`);
  });
}

async function getMessages(
  chatId: string,
  pagination?: CursorPaginationParams,
): Promise<PaginatedMessages> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const params: Record<string, string | number> = {};
    if (pagination?.cursor) params.cursor = pagination.cursor;
    if (pagination?.limit) params.limit = pagination.limit;

    const queryString = buildQueryString(params);
    const endpoint = `/chat/chats/${chatId}/messages${queryString}`;

    const response = await apiClient.get<PaginatedMessages>(endpoint);
    return ensureResponse(response, 'Failed to fetch messages');
  });
}

async function listChats(params?: {
  page?: number;
  per_page?: number;
  workspace_id?: string;
  pinned?: boolean;
}): Promise<PaginatedChats> {
  return serviceCall(async () => {
    const queryString = buildQueryString(params);
    const endpoint = `/chat/chats${queryString}`;

    const response = await apiClient.get<PaginatedChats>(endpoint);
    return ensureResponse(response, 'Failed to fetch chats');
  });
}

async function searchChats(query: string): Promise<ChatSearchResponse> {
  return serviceCall(async () => {
    const queryString = buildQueryString({ q: query });
    const response = await apiClient.get<ChatSearchResponse>(`/chat/chats/search${queryString}`);
    return ensureResponse(response, 'Failed to search chats');
  });
}

async function getChat(chatId: string): Promise<Chat> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await apiClient.get<Chat>(`/chat/chats/${chatId}`);
    return ensureResponse(response, 'Failed to fetch chat');
  });
}

async function createChat(data: CreateChatRequest): Promise<Chat> {
  return serviceCall(async () => {
    const response = await apiClient.post<Chat>('/chat/chats', data);
    return ensureResponse(response, 'Failed to create chat');
  });
}

async function updateChat(chatId: string, updateData: { title?: string }): Promise<Chat> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await apiClient.patch<Chat>(`/chat/chats/${chatId}`, updateData);
    return ensureResponse(response, 'Failed to update chat');
  });
}

async function deleteChat(chatId: string): Promise<void> {
  validateId(chatId, 'Chat ID');

  await serviceCall(async () => {
    await apiClient.delete(`/chat/chats/${chatId}`);
  });
}

async function deleteAllChats(): Promise<void> {
  await serviceCall(async () => {
    await apiClient.delete('/chat/chats/all');
  });
}

async function getContextUsage(chatId: string): Promise<ContextUsage> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await apiClient.get<ContextUsage>(`/chat/chats/${chatId}/context-usage`);
    return ensureResponse(response, 'Failed to fetch context usage');
  });
}

function normalizePositiveInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function createEventSource(
  chatId: string,
  signal?: AbortSignal,
  baselineSeq?: number,
): EventSource {
  const token = authService.getToken();
  if (!token) {
    throw new Error('Authentication token required');
  }

  const storedSeq = normalizePositiveInt(chatStorage.getEventId(chatId));
  const providedSeq = normalizePositiveInt(baselineSeq);
  const afterSeq = Math.max(storedSeq, providedSeq);
  if (afterSeq > storedSeq) {
    chatStorage.setEventId(chatId, String(afterSeq));
  }

  const baseUrl = `${apiClient.getBaseUrl()}/chat/chats/${chatId}/stream`;

  const params = new URLSearchParams();
  params.append('token', token);
  params.append('after_seq', String(afterSeq));

  const url = `${baseUrl}?${params.toString()}`;
  const eventSource = new EventSource(url);

  if (signal) {
    const abortHandler = () => {
      signal.removeEventListener('abort', abortHandler);
      eventSource.close();
    };

    signal.addEventListener('abort', abortHandler);
    if (signal.aborted) {
      abortHandler();
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
  }

  return eventSource;
}

async function getSubThreads(chatId: string): Promise<Chat[]> {
  validateId(chatId, 'Chat ID');
  return serviceCall(async () => {
    const response = await apiClient.get<Chat[]>(`/chat/chats/${chatId}/sub-threads`);
    return ensureResponse(response, 'Failed to fetch sub-threads');
  });
}

async function pinChat(chatId: string): Promise<Chat> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await apiClient.patch<Chat>(`/chat/chats/${chatId}`, { pinned: true });
    return ensureResponse(response, 'Failed to pin chat');
  });
}

async function unpinChat(chatId: string): Promise<Chat> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await apiClient.patch<Chat>(`/chat/chats/${chatId}`, { pinned: false });
    return ensureResponse(response, 'Failed to unpin chat');
  });
}

async function enhancePrompt(prompt: string, modelId: string): Promise<string> {
  validateRequired(prompt, 'Prompt');
  validateRequired(modelId, 'Model ID');

  return serviceCall(async () => {
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('model_id', modelId);

    const response = await apiClient.postForm<{ enhanced_prompt: string }>(
      '/chat/enhance-prompt',
      formData,
    );

    return ensureResponse(response, 'Failed to enhance prompt').enhanced_prompt;
  });
}

async function getMessageChanges(messageId: string): Promise<ChangedFilesData> {
  validateId(messageId, 'Message ID');

  return serviceCall(async () => {
    const response = await apiClient.get<ChangedFilesData>(`/chat/messages/${messageId}/changes`);
    return ensureResponse(response, 'Failed to load changed files');
  });
}

async function getMessageFileDiff(messageId: string, path: string): Promise<FileDiffData> {
  validateId(messageId, 'Message ID');
  validateRequired(path, 'Path');

  return serviceCall(async () => {
    const queryString = buildQueryString({ path });
    const response = await apiClient.get<FileDiffData>(
      `/chat/messages/${messageId}/changes/diff${queryString}`,
    );
    return ensureResponse(response, 'Failed to load file diff');
  });
}

async function restoreMessageCheckpoint(messageId: string): Promise<GitCommitResult> {
  validateId(messageId, 'Message ID');

  return serviceCall(async () => {
    const response = await apiClient.post<GitCommitResult>(
      `/chat/messages/${messageId}/checkpoint/restore-all`,
    );
    return ensureResponse(response, 'Failed to restore checkpoint');
  });
}

export const chatService = {
  createCompletion,
  checkChatStatus,
  reconnectToStream,
  stopStream,
  getMessages,
  listChats,
  searchChats,
  getChat,
  createChat,
  updateChat,
  deleteChat,
  deleteAllChats,
  getContextUsage,
  enhancePrompt,
  getMessageChanges,
  getMessageFileDiff,
  restoreMessageCheckpoint,
  pinChat,
  unpinChat,
  getSubThreads,
};
