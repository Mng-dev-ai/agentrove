import { apiClient, resolveChatClient, StreamResponse } from '@/lib/api';
import { ensureResponse, serviceCall, buildQueryString } from '@/services/base/BaseService';
import { validateRequired, validateId } from '@/utils/validation';
import { chatStorage } from '@/utils/storage';
import { isCloudChat, markCloudChats, markCloudSandboxes } from '@/utils/chatOrigin';
import type {
  ChatRequest,
  Chat,
  ChatSearchResponse,
  CreateChatRequest,
  ContextUsage,
} from '@/types/chat.types';
import type { ActiveStreamSnapshot } from '@/types/stream.types';
import type { GitCommitResult } from '@/types/sandbox.types';
import type { CursorPaginationParams, PaginatedChats, PaginatedMessages } from '@/types/api.types';
import type { ComposerSelection } from '@/store/uiStore';

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
  if (request.fast_mode) {
    formData.append('fast_mode', 'true');
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

      const taskResponse = await resolveChatClient(request.chat_id).postForm<{
        chat_id: string;
        message_id: string;
        last_seq?: number;
        checkpoint_id: string | null;
        worktree_cwd: string | null;
      }>('/chat/chat', formData, signal);

      const payload = ensureResponse(taskResponse, 'Failed to start chat completion');

      // Seed the replay cursor for the multiplexed feed: events published before
      // the shared connection (re)opens are recovered by replaying after last_seq.
      const storedSeq = normalizePositiveInt(chatStorage.getEventId(payload.chat_id));
      const providedSeq = normalizePositiveInt(payload.last_seq);
      if (providedSeq > storedSeq) {
        chatStorage.setEventId(payload.chat_id, String(providedSeq));
      }

      return {
        messageId: payload.message_id,
        checkpointId: payload.checkpoint_id,
        worktreeCwd: payload.worktree_cwd,
      };
    },
    { signal },
  );
}

// Fires a turn server-side without opening a client EventSource — used to start
// background sub-threads (e.g. stream actions). The server runs the turn as a
// background task; the client reconnects to the stream when the chat is opened.
async function startCompletion(request: ChatRequest): Promise<{ messageId: string }> {
  validateRequired(request.prompt, 'Prompt');

  return serviceCall(async () => {
    const formData = buildChatFormData(request);
    const response = await resolveChatClient(request.chat_id).postForm<{
      chat_id: string;
      message_id: string;
    }>('/chat/chat', formData);
    const payload = ensureResponse(response, 'Failed to start chat completion');
    return { messageId: payload.message_id };
  });
}

async function checkChatStatus(chatId: string): Promise<{
  has_active_task: boolean;
  message_id?: string;
  stream_id?: string;
  last_seq?: number;
} | null> {
  return serviceCall(() => resolveChatClient(chatId).get(`/chat/chats/${chatId}/status`));
}

async function getActiveStreams(): Promise<ActiveStreamSnapshot[]> {
  // Local backend only — its runtime registry covers every local chat and
  // sub-thread, so startup restoration needs a single request.
  return serviceCall(async () => {
    const streams = await apiClient.get<ActiveStreamSnapshot[]>('/chat/chats/active-streams');
    return streams ?? [];
  });
}

async function stopStream(chatId: string): Promise<void> {
  await serviceCall(async () => {
    await resolveChatClient(chatId).delete(`/chat/chats/${chatId}/stream`);
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

    const response = await resolveChatClient(chatId).get<PaginatedMessages>(endpoint);
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
    const response = await resolveChatClient(chatId).get<Chat>(`/chat/chats/${chatId}`);
    const chat = ensureResponse(response, 'Failed to fetch chat');
    // Register a cloud chat's sandbox so its files/git/terminal route to the VPS
    // even on a cold deep-link, before the sidebar list has run.
    if (isCloudChat(chatId)) {
      markCloudSandboxes([chat.sandbox_id]);
    }
    return chat;
  });
}

async function createChat(data: CreateChatRequest): Promise<Chat> {
  return serviceCall(async () => {
    // A sub-thread inherits its parent's backend — route to the cloud VPS when the
    // parent lives there, then mark the child (and its sandbox) cloud-owned so its
    // turns, files, and terminal follow it instead of falling back to local.
    const parentChatId = data.parent_chat_id;
    const response = await resolveChatClient(parentChatId).post<Chat>('/chat/chats', data);
    const chat = ensureResponse(response, 'Failed to create chat');
    if (parentChatId && isCloudChat(parentChatId)) {
      markCloudChats([chat.id]);
      markCloudSandboxes([chat.sandbox_id]);
    }
    return chat;
  });
}

async function updateChat(chatId: string, updateData: { title?: string }): Promise<Chat> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await resolveChatClient(chatId).patch<Chat>(
      `/chat/chats/${chatId}`,
      updateData,
    );
    return ensureResponse(response, 'Failed to update chat');
  });
}

async function deleteChat(chatId: string): Promise<void> {
  validateId(chatId, 'Chat ID');

  await serviceCall(async () => {
    await resolveChatClient(chatId).delete(`/chat/chats/${chatId}`);
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
    const response = await resolveChatClient(chatId).get<ContextUsage>(
      `/chat/chats/${chatId}/context-usage`,
    );
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

async function createChatEventsSource(): Promise<EventSource> {
  // Local backend only — the VPS feed is opened separately via
  // cloudChatService.createChatEventsSource, against the remote client's auth.
  // EventSource bypasses APIClient's 401→refresh path and access tokens are
  // short-lived, so mint a valid token up front instead of using the cached one.
  const token = await apiClient.getValidToken();
  if (!token) {
    throw new Error('Authentication token required');
  }

  const params = new URLSearchParams({ token });
  return new EventSource(`${apiClient.getBaseUrl()}/chat/chats/events?${params.toString()}`);
}

async function getSubThreads(chatId: string): Promise<Chat[]> {
  validateId(chatId, 'Chat ID');
  return serviceCall(async () => {
    const response = await resolveChatClient(chatId).get<Chat[]>(
      `/chat/chats/${chatId}/sub-threads`,
    );
    const subThreads = ensureResponse(response, 'Failed to fetch sub-threads');
    // A cloud parent's sub-threads live on the VPS too — register them so opening
    // one routes its stream/files/terminal to the cloud, not local.
    if (isCloudChat(chatId)) {
      markCloudChats(subThreads.map((chat) => chat.id));
      markCloudSandboxes(subThreads.map((chat) => chat.sandbox_id));
    }
    return subThreads;
  });
}

async function markChatViewed(chatId: string): Promise<void> {
  validateId(chatId, 'Chat ID');

  await serviceCall(async () => {
    await resolveChatClient(chatId).post(`/chat/chats/${chatId}/viewed`);
  });
}

async function pinChat(chatId: string): Promise<Chat> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await resolveChatClient(chatId).patch<Chat>(`/chat/chats/${chatId}`, {
      pinned: true,
    });
    return ensureResponse(response, 'Failed to pin chat');
  });
}

async function unpinChat(chatId: string): Promise<Chat> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await resolveChatClient(chatId).patch<Chat>(`/chat/chats/${chatId}`, {
      pinned: false,
    });
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

async function askAboutCode(
  chatId: string,
  selection: ComposerSelection,
  question: string,
  modelId: string,
): Promise<string> {
  validateId(chatId, 'Chat ID');
  validateRequired(question, 'Question');
  validateRequired(modelId, 'Model ID');

  return serviceCall(async () => {
    // Chat-text selections have no file identity — the location fields stay unset.
    const location =
      'kind' in selection
        ? {}
        : {
            file_path: selection.path,
            language: selection.languageId,
            start_line: selection.startLine,
            end_line: selection.endLine,
          };
    const response = await resolveChatClient(chatId).post<{ answer: string }>(
      `/chat/chats/${chatId}/ask-code`,
      {
        question,
        code: selection.text,
        model_id: modelId,
        ...location,
      },
    );

    return ensureResponse(response, 'Failed to answer question').answer;
  });
}

async function generateChatTitle(chatId: string): Promise<string> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await resolveChatClient(chatId).post<{ title: string }>(
      `/chat/chats/${chatId}/generate-title`,
    );

    return ensureResponse(response, 'Failed to generate title').title;
  });
}

// Keyed by messageId but lives on whichever backend owns the chat, so callers
// thread chatId through purely for routing.
async function restoreMessageCheckpoint(
  chatId: string | undefined,
  messageId: string,
): Promise<GitCommitResult> {
  validateId(messageId, 'Message ID');

  return serviceCall(async () => {
    const response = await resolveChatClient(chatId).post<GitCommitResult>(
      `/chat/messages/${messageId}/checkpoint/restore-all`,
    );
    return ensureResponse(response, 'Failed to restore checkpoint');
  });
}

export const chatService = {
  createCompletion,
  startCompletion,
  checkChatStatus,
  getActiveStreams,
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
  askAboutCode,
  generateChatTitle,
  restoreMessageCheckpoint,
  markChatViewed,
  pinChat,
  unpinChat,
  getSubThreads,
  createChatEventsSource,
};
