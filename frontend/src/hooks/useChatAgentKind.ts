import { useModelStore } from '@/store/modelStore';
import { getAgentKindForModelId, type AgentKind } from '@/types/chat.types';

export function useChatAgentKind(
  chatId: string,
  sessionAgentKind: AgentKind | null | undefined,
  lastModelId: string | null | undefined,
): AgentKind | null {
  const storedModelId = useModelStore((s) => s.modelByChat[chatId]);
  const modelId = storedModelId ?? lastModelId;
  return sessionAgentKind ?? (modelId ? getAgentKindForModelId(modelId) : null);
}
