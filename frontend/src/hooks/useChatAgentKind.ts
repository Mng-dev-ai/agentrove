import { useModelMap } from '@/hooks/queries/useModelQueries';
import { useChatMachineId } from '@/store/machineOrigin';
import { useModelStore } from '@/store/modelStore';
import { resolveAgentKind, type AgentKind } from '@/types/chat.types';

export function useChatAgentKind(
  chatId: string,
  sessionAgentKind: AgentKind | null | undefined,
  lastModelId: string | null | undefined,
): AgentKind | null {
  const storedModelId = useModelStore((s) => s.modelByChat[chatId]);
  const modelMap = useModelMap({ machineId: useChatMachineId(chatId) });
  const modelId = storedModelId ?? lastModelId;
  return sessionAgentKind ?? (modelId ? resolveAgentKind(modelMap, modelId) : null);
}
