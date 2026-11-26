import { useModelMap } from '@/hooks/queries/useModelQueries';
import { useChatMachineId } from '@/store/machineOrigin';
import { useModelStore } from '@/store/modelStore';
import { resolveChatAgentKind, type AgentKind } from '@/types/chat.types';

export function useChatAgentKind(
  chatId: string,
  sessionAgentKind: AgentKind | null | undefined,
  lastModelId: string | null | undefined,
): AgentKind | null {
  const storedModelId = useModelStore((s) => s.modelByChat[chatId]);
  const modelMap = useModelMap({ machineId: useChatMachineId(chatId) });
  return resolveChatAgentKind(modelMap, sessionAgentKind, storedModelId ?? lastModelId);
}
