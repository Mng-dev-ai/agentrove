import { useChatStore } from '@/store/chatStore';
import { useUIStore } from '@/store/uiStore';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { activeSplitSlot } from '@/utils/tileHelpers';
import type { Chat } from '@/types/chat.types';

const NO_SPLIT_CHATS: string[] = [];

// Resolves the chat for the pane the user last interacted with. In split view a
// split pane is a different chat with its own sandbox/worktree, so actions
// (git, sub-threads, …) target it when it's the active pane.
//
// `enabled` lets always-mounted callers (e.g. CommandMenu) gate the subscriptions
// to stable values while inactive, so pane/split churn doesn't re-render them.
export function useActiveChat(enabled = true): Chat | null {
  const primaryChat = useChatStore((s) => (enabled ? s.currentChat : null));
  const activeAgentTile = useUIStore((s) => (enabled ? s.activeAgentTile : 'agent:primary'));
  const splitChatIds = useUIStore((s) => (enabled ? s.splitChatIds : NO_SPLIT_CHATS));
  const slot = activeSplitSlot(activeAgentTile, splitChatIds);
  const splitChatId = slot ? splitChatIds[slot - 1] : undefined;
  const { data: splitChat } = useChatQuery(splitChatId, {
    enabled: enabled && !!splitChatId,
  });
  return slot ? (splitChat ?? null) : primaryChat;
}
