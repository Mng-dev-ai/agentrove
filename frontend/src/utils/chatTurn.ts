import { chatService } from '@/services/chatService';
import { useChatSettingsStore } from '@/store/chatSettingsStore';
import { useModelStore } from '@/store/modelStore';
import { useStreamStore } from '@/store/streamStore';
import type { ChatRequest } from '@/types/chat.types';

export async function startChatTurn(
  request: ChatRequest & { chat_id: string; thinking_mode: string },
): Promise<void> {
  useModelStore.getState().selectModel(request.chat_id, request.model_id);
  const settings = useChatSettingsStore.getState();
  settings.setPersona(request.chat_id, request.selected_persona_name);
  settings.setPermissionMode(request.chat_id, request.permission_mode);
  settings.setThinkingMode(request.chat_id, request.thinking_mode);

  const { messageId } = await chatService.startCompletion(request);

  // No client EventSource here — the global stream watcher reconciles this
  // metadata against the server and prunes the pulse once the turn settles.
  useStreamStore.getState().addStreamMetadata({
    chatId: request.chat_id,
    messageId,
    startTime: Date.now(),
  });
}
