// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/hooks/queries/queryKeys';
import {
  useDeleteWorkspaceMutation,
  useUpdateWorkspaceMutation,
} from '@/hooks/queries/useWorkspaceQueries';
import { useChannelStore } from '@/store/channelStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';

const MACHINE_ID = 'machine-1';
const OTHER_MACHINE_ID = 'machine-2';
const WORKSPACE_ID = 'ws-1';

const KEYS = {
  localWorkspaces: queryKeys.workspaces,
  localChats: [queryKeys.chats, 'infinite'],
  localSearch: queryKeys.chatsSearch('foo'),
  machineWorkspaces: queryKeys.machine.workspaces(MACHINE_ID),
  machineChats: queryKeys.machine.chatsPage(MACHINE_ID, 1),
  machineSearch: queryKeys.machine.chatsSearch(MACHINE_ID, 'foo'),
  otherMachineWorkspaces: queryKeys.machine.workspaces(OTHER_MACHINE_ID),
  otherMachineSearch: queryKeys.machine.chatsSearch(OTHER_MACHINE_ID, 'foo'),
  localChannels: queryKeys.channels(LOCAL_MACHINE_ID),
  machineChannels: queryKeys.channels(MACHINE_ID),
} satisfies Record<string, QueryKey>;

const REMOVED_ON_DELETE: QueryKey[] = [
  queryKeys.chat('chat-in'),
  queryKeys.messages('chat-in'),
  queryKeys.contextUsage('chat-in'),
  queryKeys.subThreads('chat-in'),
  queryKeys.channel('channel-in'),
];

const KEPT_ON_DELETE: QueryKey[] = [
  queryKeys.chat('chat-out'),
  queryKeys.messages('chat-out'),
  queryKeys.channel('channel-out'),
];

vi.mock('@/services/workspaceService', () => ({
  workspaceService: {
    updateWorkspace: vi.fn().mockResolvedValue({}),
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
  },
}));

function seededClient(): QueryClient {
  const queryClient = new QueryClient();
  for (const key of Object.values(KEYS)) queryClient.setQueryData(key, {});
  queryClient.setQueryData(queryKeys.chat('chat-in'), {
    id: 'chat-in',
    workspace_id: WORKSPACE_ID,
  });
  queryClient.setQueryData(queryKeys.chat('chat-out'), { id: 'chat-out', workspace_id: 'ws-2' });
  queryClient.setQueryData(queryKeys.channel('channel-in'), {
    id: 'channel-in',
    workspace_id: WORKSPACE_ID,
  });
  queryClient.setQueryData(queryKeys.channel('channel-out'), {
    id: 'channel-out',
    workspace_id: 'ws-2',
  });
  for (const chatId of ['chat-in', 'chat-out']) {
    queryClient.setQueryData(queryKeys.messages(chatId), {});
    queryClient.setQueryData(queryKeys.contextUsage(chatId), {});
    queryClient.setQueryData(queryKeys.subThreads(chatId), []);
  }
  return queryClient;
}

function invalidated(queryClient: QueryClient): string[] {
  return Object.entries(KEYS)
    .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
    .map(([name]) => name)
    .sort();
}

function wrapperFor(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  useChannelStore.getState().holdChannel('channel-in');
  useChannelStore.getState().holdChannel('channel-out');
});

describe('useUpdateWorkspaceMutation', () => {
  it.each([
    [LOCAL_MACHINE_ID, ['localSearch', 'localWorkspaces']],
    [MACHINE_ID, ['machineSearch', 'machineWorkspaces']],
  ])('invalidates the workspaces and chat searches of machine %s', async (machineId, expected) => {
    const queryClient = seededClient();
    const { result } = renderHook(() => useUpdateWorkspaceMutation(), {
      wrapper: wrapperFor(queryClient),
    });

    await result.current.mutateAsync({
      machineId,
      workspaceId: WORKSPACE_ID,
      data: { name: 'Renamed' },
    });

    expect(invalidated(queryClient)).toEqual(expected);
  });
});

describe('useDeleteWorkspaceMutation', () => {
  it.each([
    [
      LOCAL_MACHINE_ID,
      ['localChannels', 'localChats', 'localSearch', 'localWorkspaces', 'machineChannels'],
    ],
    [
      MACHINE_ID,
      ['localChannels', 'machineChannels', 'machineChats', 'machineSearch', 'machineWorkspaces'],
    ],
  ])(
    "drops the deleted workspace's chats and channels and invalidates the lists of machine %s",
    async (machineId, expected) => {
      const queryClient = seededClient();
      const { result } = renderHook(() => useDeleteWorkspaceMutation(), {
        wrapper: wrapperFor(queryClient),
      });

      await result.current.mutateAsync({ machineId, workspaceId: WORKSPACE_ID });

      for (const key of REMOVED_ON_DELETE) expect(queryClient.getQueryState(key)).toBeUndefined();
      for (const key of KEPT_ON_DELETE) expect(queryClient.getQueryState(key)).toBeDefined();
      expect(Object.keys(useChannelStore.getState().channels)).toEqual(['channel-out']);
      expect(invalidated(queryClient)).toEqual(expected);
    },
  );
});
