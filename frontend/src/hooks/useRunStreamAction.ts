import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useCreateSubThreadMutation } from '@/hooks/queries/useChatQueries';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { coercePermissionModeForAgent } from '@/components/chat/permission-mode-selector/permissionModes';
import { coerceThinkingModeForAgent } from '@/components/chat/thinking-mode-selector/thinkingModes';
import { startChatTurn } from '@/utils/chatTurn';
import { getAgentKindForModelId } from '@/types/chat.types';
import type { Chat } from '@/types/chat.types';
import type { StreamAction } from '@/types/user.types';

// Spawns a stream action as a sub-thread, starts the turn server-side, then navigates there.
export function useRunStreamAction(parentChat: Chat | undefined) {
  const navigate = useNavigate();
  const createSubThread = useCreateSubThreadMutation(parentChat?.id ?? '');
  const modelMap = useModelMap();

  return useCallback(
    async (action: StreamAction) => {
      if (!parentChat) return;

      const model = modelMap.get(action.model_id);
      const agentKind = model?.agent_kind ?? getAgentKindForModelId(action.model_id);
      const permissionMode = coercePermissionModeForAgent(action.permission_mode, agentKind);
      const thinkingMode = coerceThinkingModeForAgent(action.thinking_mode, agentKind, model);

      try {
        const newChat = await createSubThread.mutateAsync({
          title: action.label,
          model_id: action.model_id,
          workspace_id: parentChat.workspace_id,
          parent_chat_id: parentChat.id,
        });

        await startChatTurn({
          prompt: action.command,
          chat_id: newChat.id,
          model_id: action.model_id,
          permission_mode: permissionMode,
          thinking_mode: thinkingMode,
          selected_persona_name: action.persona_name,
        });

        toast.success(`Started "${action.label}"`);
        // Navigation also adds the tab via loadWorkspaceForChat.
        navigate(`/chat/${newChat.id}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Failed to start "${action.label}"`);
      }
    },
    [parentChat, createSubThread, navigate, modelMap],
  );
}
