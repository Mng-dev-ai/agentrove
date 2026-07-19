import { useModelStore } from '@/store/modelStore';
import { getAgentKindForModelId, type AgentKind } from '@/types/chat.types';

export function useChatAgentKind(
  chatId: string,
  sessionAgentKind: AgentKind | null | undefined,
): AgentKind | null {
  // session_agent_kind arrives mid-stream/after complete; until then derive from local model.
  const storedModelId = useModelStore((s) => s.modelByChat[chatId]);
  return sessionAgentKind ?? (storedModelId ? getAgentKindForModelId(storedModelId) : null);
}
