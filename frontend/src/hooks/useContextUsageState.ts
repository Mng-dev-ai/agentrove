import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useContextUsageQuery } from '@/hooks/queries/useChatQueries';
import type { Chat, ContextUsage } from '@/types/chat.types';
import { CONTEXT_WINDOW_TOKENS } from '@/config/constants';

interface ContextUsageState {
  tokensUsed: number;
  contextWindow: number;
}

interface UseContextUsageStateResult {
  contextUsage: ContextUsageState;
  updateContextUsage: (data: ContextUsage, chatId?: string) => void;
}

// Token usage from chat cache (nav), context-usage query (load), or live SSE — last write wins.
export function useContextUsageState(
  chatId: string | undefined,
  currentChat: Chat | undefined,
  modelContextWindow: number | null | undefined,
): UseContextUsageStateResult {
  const effectiveContextWindow = modelContextWindow ?? CONTEXT_WINDOW_TOKENS;
  const [tokensUsed, setTokensUsed] = useState(0);
  const prevChatIdRef = useRef<string | undefined>(chatId);
  const currentChatIdRef = useRef<string | undefined>(chatId);

  useEffect(() => {
    const chatIdChanged = prevChatIdRef.current !== chatId;
    prevChatIdRef.current = chatId;
    currentChatIdRef.current = chatId;

    if (!chatId) {
      setTokensUsed(0);
      return;
    }

    const hasMatchingChatUsage =
      currentChat?.id === chatId && currentChat.context_token_usage !== undefined;

    if (chatIdChanged && !hasMatchingChatUsage) {
      setTokensUsed(0);
    }

    if (hasMatchingChatUsage) {
      // hasMatchingChatUsage already gates on context_token_usage !== undefined;
      // the ?? 0 only satisfies the type narrowing and never actually triggers.
      setTokensUsed(currentChat.context_token_usage ?? 0);
    }
  }, [chatId, currentChat?.context_token_usage, currentChat?.id]);

  const { data: contextUsageData } = useContextUsageQuery(chatId, { enabled: !!chatId });

  useEffect(() => {
    if (!chatId || !contextUsageData) return;
    setTokensUsed(contextUsageData.tokens_used);
  }, [chatId, contextUsageData]);

  // Ignore off-screen chat updates so counts don't bleed across switches.
  const updateContextUsage = useCallback((data: ContextUsage, incomingChatId?: string) => {
    if (incomingChatId && incomingChatId !== currentChatIdRef.current) {
      return;
    }
    setTokensUsed(data.tokens_used);
  }, []);

  const contextUsage = useMemo<ContextUsageState>(
    () => ({ tokensUsed, contextWindow: effectiveContextWindow }),
    [tokensUsed, effectiveContextWindow],
  );

  return { contextUsage, updateContextUsage };
}
