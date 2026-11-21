// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Chat } from '@/types/chat.types';
import { applyCreatedChat } from './useChatQueries';
import { queryKeys } from './queryKeys';

describe('applyCreatedChat', () => {
  it('invalidates the sub-thread list that still holds a chat created without a parent', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.subThreads('old-parent'), [
      { id: 'promoted', parent_chat_id: 'old-parent' } as Chat,
    ]);
    queryClient.setQueryData(queryKeys.subThreads('other-parent'), [
      { id: 'sibling', parent_chat_id: 'other-parent' } as Chat,
    ]);

    await applyCreatedChat(queryClient, { id: 'promoted', parent_chat_id: null } as Chat);

    const isInvalidated = (parentId: string) =>
      queryClient.getQueryState(queryKeys.subThreads(parentId))?.isInvalidated;
    expect(isInvalidated('old-parent')).toBe(true);
    expect(isInvalidated('other-parent')).toBe(false);
  });
});
