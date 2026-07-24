import { resolveChatClient } from '@/lib/api';
import { ensureResponse, serviceCall } from '@/services/base/BaseService';
import { DEFAULT_PERSONA, DEFAULT_PERMISSION_MODE } from '@/store/chatSettingsStore';
import { validateId, validateRequired } from '@/utils/validation';
import type { QueuedMessage, QueueAddResponse, QueueMessageOptions } from '@/types/queue.types';

async function queueMessage(
  chatId: string,
  content: string,
  modelId: string,
  options: QueueMessageOptions = {},
): Promise<QueueAddResponse> {
  validateId(chatId, 'Chat ID');
  validateRequired(content, 'Content');
  validateRequired(modelId, 'Model ID');

  const {
    permissionMode = DEFAULT_PERMISSION_MODE,
    thinkingMode = null,
    worktree = false,
    baseBranch,
    fastMode = false,
    selectedPersonaName = DEFAULT_PERSONA,
    files,
  } = options;

  return serviceCall(async () => {
    const formData = new FormData();
    formData.append('content', content);
    formData.append('model_id', modelId);
    formData.append('permission_mode', permissionMode);
    if (thinkingMode) {
      formData.append('thinking_mode', thinkingMode);
    }
    if (worktree) {
      formData.append('worktree', 'true');
    }
    if (worktree && baseBranch) {
      formData.append('base_branch', baseBranch);
    }
    if (fastMode) {
      formData.append('fast_mode', 'true');
    }
    formData.append('selected_persona_name', selectedPersonaName);

    if (files) {
      files.forEach((file) => {
        formData.append('attached_files', file);
      });
    }

    const response = await resolveChatClient(chatId).postForm<QueueAddResponse>(
      `/chat/chats/${chatId}/queue`,
      formData,
    );
    return ensureResponse(response, 'Failed to queue message');
  });
}

async function getQueue(chatId: string): Promise<QueuedMessage[]> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await resolveChatClient(chatId).get<QueuedMessage[]>(
      `/chat/chats/${chatId}/queue`,
    );
    return ensureResponse(response, 'Failed to fetch queue');
  });
}

async function updateQueuedMessage(
  chatId: string,
  messageId: string,
  content: string,
): Promise<QueuedMessage> {
  validateId(chatId, 'Chat ID');
  validateId(messageId, 'Message ID');
  validateRequired(content, 'Content');

  return serviceCall(async () => {
    const response = await resolveChatClient(chatId).patch<QueuedMessage>(
      `/chat/chats/${chatId}/queue/${messageId}`,
      { content },
    );
    return ensureResponse(response, 'Failed to update queued message');
  });
}

async function deleteQueuedMessage(chatId: string, messageId: string): Promise<void> {
  validateId(chatId, 'Chat ID');
  validateId(messageId, 'Message ID');

  await serviceCall(async () => {
    await resolveChatClient(chatId).delete(`/chat/chats/${chatId}/queue/${messageId}`);
  });
}

async function sendNow(chatId: string, messageId: string): Promise<void> {
  validateId(chatId, 'Chat ID');
  validateId(messageId, 'Message ID');

  await serviceCall(async () => {
    await resolveChatClient(chatId).post(`/chat/chats/${chatId}/queue/${messageId}/send-now`);
  });
}

async function clearQueue(chatId: string): Promise<void> {
  validateId(chatId, 'Chat ID');

  await serviceCall(async () => {
    await resolveChatClient(chatId).delete(`/chat/chats/${chatId}/queue`);
  });
}

export const queueService = {
  queueMessage,
  getQueue,
  updateQueuedMessage,
  deleteQueuedMessage,
  sendNow,
  clearQueue,
};
