import { useModelStore } from '@/store/modelStore';
import { getAgentKindForModelId, type AgentKind } from '@/types/chat.types';

export function useChatAgentKind(
  chatId: string,
  sessionAgentKind: AgentKind | null | undefined,
): AgentKind | null {
  // session_agent_kind is only persisted server-side mid-stream and refetched after
  // completion — until then, derive the kind from the locally selected model so the
  // provider glyph shows during a chat's first stream. No stored model means the kind
  // is genuinely unknown (e.g. pre-existing chat from another device) — show no icon.
  const storedModelId = useModelStore((s) => s.modelByChat[chatId]);
  return sessionAgentKind ?? (storedModelId ? getAgentKindForModelId(storedModelId) : null);
}
