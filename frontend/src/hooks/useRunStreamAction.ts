import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { chatService } from '@/services/chatService';
import { useCreateSubThreadMutation } from '@/hooks/queries/useChatQueries';
import { useModelStore } from '@/store/modelStore';
import { useStreamStore } from '@/store/streamStore';
import { useChatSettingsStore } from '@/store/chatSettingsStore';
import { coercePermissionModeForAgent } from '@/components/chat/permission-mode-selector/permissionModes';
import { coerceThinkingModeForAgent } from '@/components/chat/thinking-mode-selector/thinkingModes';
import { getAgentKindForModelId } from '@/types/chat.types';
import type { Chat } from '@/types/chat.types';
import type { StreamAction } from '@/types/user.types';

// Spawns a stream action as a background sub-thread: creates the sub-thread,
// fires its turn server-side, and registers stream metadata so the sidebar
// shows the pulse without the user opening it.
export function useRunStreamAction(parentChat: Chat | undefined) {
  const createSubThread = useCreateSubThreadMutation(parentChat?.id ?? '');

  return useCallback(
    async (action: StreamAction) => {
      if (!parentChat) return;

      const agentKind = getAgentKindForModelId(action.model_id);
      const permissionMode = coercePermissionModeForAgent(action.permission_mode, agentKind);
      const thinkingMode = coerceThinkingModeForAgent(
        action.thinking_mode,
        agentKind,
        action.model_id,
      );

      try {
        const newChat = await createSubThread.mutateAsync({
          title: action.label,
          model_id: action.model_id,
          workspace_id: parentChat.workspace_id,
          parent_chat_id: parentChat.id,
        });

        useModelStore.getState().selectModel(newChat.id, action.model_id);
        const settings = useChatSettingsStore.getState();
        settings.setPersona(newChat.id, action.persona_name);
        settings.setPermissionMode(newChat.id, permissionMode);
        settings.setThinkingMode(newChat.id, thinkingMode);

        const { messageId } = await chatService.startCompletion({
          prompt: action.command,
          chat_id: newChat.id,
          model_id: action.model_id,
          permission_mode: permissionMode,
          thinking_mode: thinkingMode,
          selected_persona_name: action.persona_name,
        });

        // No client EventSource here — the global stream watcher reconciles this
        // metadata against the server and prunes the pulse once the turn settles.
        useStreamStore.getState().addStreamMetadata({
          chatId: newChat.id,
          messageId,
          startTime: Date.now(),
        });

        toast.success(`Started "${action.label}"`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Failed to start "${action.label}"`);
      }
    },
    [parentChat, createSubThread],
  );
}
