// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useDeleteChannelMutation } from '@/hooks/queries/useChannelQueries';
import { useDeleteChatMutation } from '@/hooks/queries/useChatQueries';
import { useModelStore } from '@/store/modelStore';

vi.mock('@/services/chatService', () => ({
  chatService: {
    deleteChat: vi.fn().mockResolvedValue(undefined),
    getSubThreads: vi.fn().mockResolvedValue([{ id: 'child-uncached' }]),
  },
}));

vi.mock('@/services/channelService', () => ({
  channelService: { deleteChannel: vi.fn().mockResolvedValue(undefined) },
}));

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function hasModel(chatId: string): boolean {
  return chatId in useModelStore.getState().modelByChat;
}

describe('delete mutations forget per-chat state', () => {
  it('forgets sub-threads the server lists even when their list was never loaded', async () => {
    for (const id of ['parent', 'child-uncached', 'other']) {
      useModelStore.getState().selectModel(id, 'gpt-5');
    }
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useDeleteChatMutation(), {
      wrapper: wrapperFor(queryClient),
    });

    await result.current.mutateAsync('parent');

    expect(hasModel('parent')).toBe(false);
    expect(hasModel('child-uncached')).toBe(false);
    expect(hasModel('other')).toBe(true);
  });

  it('forgets the anchor, current and former member chats of a deleted channel', async () => {
    for (const id of ['anchor', 'member', 'former', 'outside']) {
      useModelStore.getState().selectModel(id, 'gpt-5');
    }
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.channel('channel-1'), {
      id: 'channel-1',
      anchor_chat_id: 'anchor',
      members: [{ chat_id: 'member' }],
      former_members: [{ chat_id: 'former' }],
    });
    const { result } = renderHook(() => useDeleteChannelMutation(), {
      wrapper: wrapperFor(queryClient),
    });

    await result.current.mutateAsync('channel-1');

    for (const id of ['anchor', 'member', 'former']) expect(hasModel(id), id).toBe(false);
    expect(hasModel('outside')).toBe(true);
  });
});
