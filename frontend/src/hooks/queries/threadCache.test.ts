// @vitest-environment jsdom

import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useMachineStore } from '@/store/machineStore';
import { assignChatsToMachine } from '@/store/machineOrigin';
import type { PaginatedChats } from '@/types/api.types';
import type { Channel } from '@/types/channel.types';
import type { Chat } from '@/types/chat.types';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { evictThread } from './threadCache';

const page = (ids: string[]): PaginatedChats =>
  ({
    items: ids.map((id) => ({ id }) as Chat),
    page: 1,
    per_page: 20,
    total: ids.length,
    pages: 1,
  }) as PaginatedChats;
const ids = (data: PaginatedChats | undefined) => data?.items.map((chat) => chat.id);

let queryClient: QueryClient;
const localKey = [queryKeys.chats, 'infinite', { perPage: 20 }];
const remotePageKey = queryKeys.machine.chatsPage('m1', 1);

beforeEach(() => {
  queryClient = new QueryClient();
  queryClient.setQueryData<InfiniteData<PaginatedChats>>(localKey, {
    pages: [page(['local-gone', 'local-kept'])],
    pageParams: [1],
  });
  queryClient.setQueryData(remotePageKey, page(['remote-gone', 'remote-kept']));
  queryClient.setQueryData<Channel[]>(queryKeys.channels(LOCAL_MACHINE_ID), [
    { id: 'channel-gone' } as Channel,
    { id: 'channel-kept' } as Channel,
  ]);
});

describe('evictThread', () => {
  it('drops a gone chat or channel from every cached list and keeps the rest', () => {
    useMachineStore.setState({
      machines: [{ id: 'm1', name: 'VPS', url: 'https://vps.test', pairing: null }],
    });
    assignChatsToMachine('m1', ['remote-gone']);
    evictThread(queryClient, { kind: 'chat', id: 'local-gone' });
    evictThread(queryClient, { kind: 'chat', id: 'remote-gone' });
    evictThread(queryClient, { kind: 'channel', id: 'channel-gone' });

    const local = queryClient.getQueryData<InfiniteData<PaginatedChats>>(localKey);
    expect(ids(local?.pages[0])).toEqual(['local-kept']);
    expect(ids(queryClient.getQueryData<PaginatedChats>(remotePageKey))).toEqual(['remote-kept']);
    expect(
      queryClient
        .getQueryData<Channel[]>(queryKeys.channels(LOCAL_MACHINE_ID))
        ?.map((channel) => channel.id),
    ).toEqual(['channel-kept']);
  });
});
