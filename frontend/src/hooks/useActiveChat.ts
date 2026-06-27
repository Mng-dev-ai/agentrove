import { useChatStore } from '@/store/chatStore';
import { useUIStore } from '@/store/uiStore';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { isSecondaryPaneActive } from '@/utils/tileHelpers';
import type { Chat } from '@/types/chat.types';

// Resolves the chat for the pane the user last interacted with. In split view the
// secondary pane is a different chat with its own sandbox/worktree, so actions
// (git, sub-threads, …) target it when it's the active pane.
//
// `enabled` lets always-mounted callers (e.g. CommandMenu) gate the subscriptions
// to stable values while inactive, so pane/secondary churn doesn't re-render them.
export function useActiveChat(enabled = true): Chat | null {
  const primaryChat = useChatStore((s) => (enabled ? s.currentChat : null));
  const activeAgentTile = useUIStore((s) => (enabled ? s.activeAgentTile : 'agent:primary'));
  const secondaryChatId = useUIStore((s) => (enabled ? s.secondaryChatId : null));
  const useSecondary = isSecondaryPaneActive(activeAgentTile, secondaryChatId);
  const { data: secondaryChat } = useChatQuery(secondaryChatId ?? undefined, {
    enabled: enabled && useSecondary,
  });
  return useSecondary ? (secondaryChat ?? null) : primaryChat;
}
