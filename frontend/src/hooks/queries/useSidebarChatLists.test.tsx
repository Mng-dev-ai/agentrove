// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { ServiceError } from '@/services/base/ServiceError';
import { chatService } from '@/services/chatService';
import { machineChatService } from '@/services/machineChatService';
import { assignChatRecordsToMachine, chatMachineId } from '@/store/machineOrigin';
import { useMachineStore } from '@/store/machineStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { PaginatedChats } from '@/types/api.types';
import type { Chat } from '@/types/chat.types';
import { useSidebarChatLists } from './useSidebarChatLists';

const REMOTE_ID = 'vps';
const LOCAL_PAGES = [
  ['local-1', 'local-2'],
  ['local-3', 'local-4'],
];
const REMOTE_PAGES = [
  ['remote-1', 'remote-2'],
  ['remote-3', 'remote-4'],
  ['remote-5', 'remote-6'],
];
const DAY: Record<string, number> = {
  'local-1': 30,
  'remote-1': 29,
  'remote-2': 28,
  'remote-3': 27,
  'remote-4': 26,
  'remote-5': 25,
  'remote-6': 24,
  'local-2': 20,
  'local-3': 10,
  'local-4': 5,
};

function chat(id: string): Chat {
  const timestamp = new Date(Date.UTC(2026, 9, DAY[id])).toISOString();
  return {
    id,
    user_id: 'user',
    title: id,
    workspace_id: 'workspace',
    sandbox_id: `sandbox-${id}`,
    created_at: timestamp,
    updated_at: timestamp,
    pinned_at: null,
    worktree_cwd: null,
    parent_chat_id: null,
    channel_id: null,
    sub_thread_count: 0,
    session_agent_kind: null,
    unread: false,
    last_model_id: null,
    last_thinking_mode: null,
    last_persona_name: null,
  };
}

function pageOf(pages: string[][], page: number): PaginatedChats {
  const items = pages[page - 1].map(chat);
  return { items, page, per_page: 2, total: pages.length * 2, pages: pages.length };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const ids = (chats: Chat[]) => chats.map((c) => c.id);

describe('useSidebarChatLists Show more', () => {
  let laterRemotePage: () => Promise<void>;

  beforeEach(() => {
    queryClient = new QueryClient();
    laterRemotePage = () => Promise.resolve();
    useMachineStore.setState({
      machines: [{ id: REMOTE_ID, name: 'VPS', url: 'https://vps.test', pairing: null }],
      connections: { [REMOTE_ID]: { status: 'online' } },
    });
    vi.spyOn(chatService, 'listChats').mockImplementation(async (params) =>
      params?.pinned
        ? { items: [], page: 1, per_page: 2, total: 0, pages: 0 }
        : pageOf(LOCAL_PAGES, params?.page ?? 1),
    );
    vi.spyOn(machineChatService, 'listWorkspaces').mockResolvedValue([]);
    vi.spyOn(machineChatService, 'listChats').mockImplementation(async (machineId, params) => {
      const page = params?.page ?? 1;
      if (page > 1) await laterRemotePage();
      const data = pageOf(REMOTE_PAGES, page);
      assignChatRecordsToMachine(machineId, data.items);
      return data;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useMachineStore.setState({ machines: [], connections: {} });
  });

  it('pages only the filtered source, so a dense excluded machine cannot hold rows back', async () => {
    const { result } = renderHook(() => useSidebarChatLists([], true, LOCAL_MACHINE_ID), {
      wrapper,
    });
    const visible = () =>
      ids(result.current.recentChats.filter((c) => chatMachineId(c.id) === LOCAL_MACHINE_ID));
    await waitFor(() => expect(visible()).toEqual(['local-1', 'local-2']));

    act(() => result.current.loadMore());

    await waitFor(() => expect(visible()).toEqual(['local-1', 'local-2', 'local-3', 'local-4']));
    expect(result.current.hasMore).toBe(false);
  });

  it('keeps a remote source holding older rows back while its next page loads', async () => {
    let releaseRemotePage = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseRemotePage = resolve;
    });
    laterRemotePage = () => gate;
    const { result } = renderHook(() => useSidebarChatLists([]), { wrapper });
    const firstPage = ['local-1', 'remote-1', 'remote-2'];
    await waitFor(() => expect(ids(result.current.recentChats)).toEqual(firstPage));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.canShowLess).toBe(true));
    await waitFor(() => expect(chatService.listChats).toHaveBeenCalledTimes(3));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(ids(result.current.recentChats)).toEqual(firstPage);
    expect(result.current.isFetchingMore).toBe(true);

    releaseRemotePage();
    await waitFor(() =>
      expect(ids(result.current.recentChats)).toEqual([...firstPage, 'remote-3', 'remote-4']),
    );
  });

  it('leaves Show more alone while a loaded remote page refreshes in the background', async () => {
    const { result } = renderHook(() => useSidebarChatLists([]), { wrapper });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() => expect(ids(result.current.recentChats)).toContain('remote-4'));
    await waitFor(() => expect(result.current.isFetchingMore).toBe(false));

    laterRemotePage = () => new Promise(() => {});
    const calls = vi.mocked(machineChatService.listChats).mock.calls.length;
    act(() => {
      void queryClient.refetchQueries({ queryKey: queryKeys.machine.chatsPage(REMOTE_ID, 2) });
    });
    await waitFor(() =>
      expect(vi.mocked(machineChatService.listChats).mock.calls.length).toBeGreaterThan(calls),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(result.current.isFetchingMore).toBe(false);
  });

  it('keeps a failed remote page holding rows back, and Show more retries that page', async () => {
    laterRemotePage = () => Promise.reject(new ServiceError('gone', undefined, undefined, 404));
    const { result } = renderHook(() => useSidebarChatLists([]), { wrapper });
    const firstPage = ['local-1', 'remote-1', 'remote-2'];
    await waitFor(() => expect(ids(result.current.recentChats)).toEqual(firstPage));

    const remotePages = () =>
      vi.mocked(machineChatService.listChats).mock.calls.map(([, params]) => params?.page);
    act(() => result.current.loadMore());
    await waitFor(() => expect(remotePages()).toContain(2));
    await waitFor(() => expect(result.current.isFetchingMore).toBe(false));
    expect(ids(result.current.recentChats)).toEqual(firstPage);
    expect(result.current.hasMore).toBe(true);

    laterRemotePage = () => Promise.resolve();
    act(() => result.current.loadMore());

    await waitFor(() =>
      expect(ids(result.current.recentChats)).toEqual([...firstPage, 'remote-3', 'remote-4']),
    );
    expect(remotePages()).not.toContain(3);
  });
});
