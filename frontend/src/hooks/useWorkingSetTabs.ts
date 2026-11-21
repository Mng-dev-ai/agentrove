import { useMemo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useStreamStore } from '@/store/streamStore';
import { useBlockedChatIds } from '@/hooks/useBlockedChatIds';

export function useWorkingSetTabs(): string[] {
  const chatTabs = useUIStore((s) => s.chatTabs);
  const activeStreamMetadata = useStreamStore((s) => s.activeStreamMetadata);
  // Pending plan/permission requests or agent question forms — blocked on the user.
  const blockedChatIdSet = useBlockedChatIds();
  return useMemo(() => {
    const streaming = new Set(activeStreamMetadata.map((meta) => meta.chatId));
    return chatTabs.filter((chatId) => streaming.has(chatId) || blockedChatIdSet.has(chatId));
  }, [chatTabs, activeStreamMetadata, blockedChatIdSet]);
}
