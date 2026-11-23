// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { localSource, localStreams, machineSource, machineStreams } = vi.hoisted(() => ({
  localSource: vi.fn(),
  localStreams: vi.fn(),
  machineSource: vi.fn(),
  machineStreams: vi.fn(),
}));

vi.mock('@/services/chatService', () => ({
  chatService: { createChatEventsSource: localSource, getActiveStreams: localStreams },
}));
vi.mock('@/services/machineChatService', () => ({
  machineChatService: { createChatEventsSource: machineSource, getActiveStreams: machineStreams },
}));

import { useChatEvents } from './useChatEvents';
import { useRemoteMachineSync } from './useRemoteMachineSync';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { assignChatsToMachine } from '@/store/machineOrigin';
import { useMachineStore } from '@/store/machineStore';
import { useStreamStore } from '@/store/streamStore';
import { useUIStore } from '@/store/uiStore';
import type { Chat, ChatEvent } from '@/types/chat.types';

const MACHINE_ID = 'machine-1';
const OTHER_MACHINE_ID = 'machine-2';

class FakeEventSource {
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listener: ((event: Event) => void) | undefined;

  addEventListener(_name: string, listener: (event: Event) => void) {
    this.listener = listener;
  }

  close() {}

  emit(data: string) {
    this.listener?.({ data } as MessageEvent);
  }

  reconnect() {
    this.onerror?.();
    this.onopen?.();
  }
}

const ORIGINS = [
  {
    name: 'local',
    logContext: 'useChatEvents',
    useSync: () => useChatEvents(),
    createSource: localSource,
    getActiveStreams: localStreams,
    own: () => {},
    chatsKey: [queryKeys.chats, 'infinite'] as QueryKey,
    workspacesKey: queryKeys.workspaces as QueryKey,
    renameRefetchesChats: false,
  },
  {
    name: 'remote',
    logContext: 'useRemoteMachineSync',
    useSync: () => useRemoteMachineSync(MACHINE_ID),
    createSource: machineSource,
    getActiveStreams: machineStreams,
    own: (chatId: string) => assignChatsToMachine(MACHINE_ID, [chatId]),
    chatsKey: queryKeys.machine.chats(MACHINE_ID) as QueryKey,
    workspacesKey: queryKeys.machine.workspaces(MACHINE_ID) as QueryKey,
    renameRefetchesChats: true,
  },
];

type Origin = (typeof ORIGINS)[number];

let queryClient: QueryClient;
let chatId: string;
let chatCount = 0;

function makeChat(id: string, overrides: Partial<Chat> = {}): Chat {
  return {
    id,
    user_id: 'u1',
    title: 'old title',
    workspace_id: 'w1',
    sandbox_id: `sandbox-${id}`,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
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
    ...overrides,
  };
}

function streamStarted(id: string): string {
  const event: ChatEvent = {
    kind: 'stream_started',
    chat_id: id,
    parent_chat_id: 'parent',
    message_id: `message-${id}`,
    attachments: null,
    model_id: 'model-new',
    checkpoint_id: null,
  };
  return JSON.stringify(event);
}

async function mount(origin: Origin): Promise<FakeEventSource> {
  const source = new FakeEventSource();
  origin.createSource.mockResolvedValue(source);
  renderHook(origin.useSync, {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
  await waitFor(() => expect(source.onopen).not.toBeNull());
  return source;
}

function seedLists(origin: Origin): void {
  queryClient.setQueryData(origin.chatsKey, { pages: [], pageParams: [] });
  queryClient.setQueryData(origin.workspacesKey, []);
}

const isInvalidated = (key: QueryKey) => queryClient.getQueryState(key)?.isInvalidated;
const trackedStreams = () =>
  useStreamStore.getState().activeStreamMetadata.map(({ chatId: id, messageId }) => ({
    chatId: id,
    messageId,
  }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  queryClient = new QueryClient();
  chatId = `chat-${++chatCount}`;
  useUIStore.setState({ chatTabs: [] });
  useStreamStore.setState({ activeStreamMetadata: [] });
  useMachineStore.setState({
    machines: [MACHINE_ID, OTHER_MACHINE_ID].map((id) => ({
      id,
      name: id,
      url: `https://${id}.test`,
      pairing: null,
    })),
  });
  localStreams.mockResolvedValue([]);
  machineStreams.mockResolvedValue([]);
});

describe.each(ORIGINS)('chat events from a $name origin', (origin) => {
  it('caches a created chat, refetches its lists and opens its tab', async () => {
    seedLists(origin);
    const source = await mount(origin);
    const chat = makeChat(chatId);

    source.emit(JSON.stringify({ kind: 'chat_created', chat }));

    expect(queryClient.getQueryData(queryKeys.chat(chatId))).toEqual(chat);
    expect(isInvalidated(origin.workspacesKey)).toBe(true);
    expect(useUIStore.getState().chatTabs).toEqual([chatId]);
  });

  it('renames a chat in place and refetches sub-thread lists holding it', async () => {
    origin.own(chatId);
    seedLists(origin);
    queryClient.setQueryData(queryKeys.chat(chatId), makeChat(chatId));
    queryClient.setQueryData(queryKeys.subThreads('parent'), [makeChat(chatId)]);
    const source = await mount(origin);

    source.emit(JSON.stringify({ kind: 'title_updated', chat_id: chatId, title: 'new title' }));

    expect(queryClient.getQueryData<Chat>(queryKeys.chat(chatId))?.title).toBe('new title');
    expect(isInvalidated(queryKeys.subThreads('parent'))).toBe(true);
    expect(isInvalidated(origin.chatsKey)).toBe(origin.renameRefetchesChats);
    expect(useUIStore.getState().chatTabs).toEqual([]);
  });

  it('tracks a started stream, patches the chat and refetches around it', async () => {
    seedLists(origin);
    queryClient.setQueryData(queryKeys.chat(chatId), makeChat(chatId));
    queryClient.setQueryData(queryKeys.subThreads('parent'), []);
    const source = await mount(origin);

    source.emit(streamStarted(chatId));

    expect(useUIStore.getState().chatTabs).toEqual([chatId]);
    expect(trackedStreams()).toEqual([{ chatId, messageId: `message-${chatId}` }]);
    expect(queryClient.getQueryData<Chat>(queryKeys.chat(chatId))?.last_model_id).toBe('model-new');
    expect(isInvalidated(origin.chatsKey)).toBe(true);
    expect(isInvalidated(origin.workspacesKey)).toBe(true);
    expect(isInvalidated(queryKeys.chat(chatId))).toBe(true);
    expect(isInvalidated(queryKeys.subThreads('parent'))).toBe(true);
  });

  it('refetches lists and chats and re-registers active streams on resync', async () => {
    origin.own(chatId);
    seedLists(origin);
    queryClient.setQueryData(queryKeys.chat(chatId), makeChat(chatId));
    const source = await mount(origin);
    origin.getActiveStreams.mockResolvedValue([
      { chat_id: chatId, message_id: 'm1', stream_id: null, last_seq: 0 },
    ]);

    source.reconnect();

    await waitFor(() => expect(trackedStreams()).toEqual([{ chatId, messageId: 'm1' }]));
    expect(isInvalidated(origin.chatsKey)).toBe(true);
    expect(isInvalidated(origin.workspacesKey)).toBe(true);
    expect(isInvalidated(queryKeys.chat(chatId))).toBe(true);
  });

  it('logs and ignores malformed JSON', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = await mount(origin);

    source.emit('{not json');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[${origin.logContext}] Malformed chat event`),
      expect.any(SyntaxError),
    );
    expect(useUIStore.getState().chatTabs).toEqual([]);
    expect(trackedStreams()).toEqual([]);
  });
});

describe('chat events from a remote origin', () => {
  const remote = ORIGINS[1];

  it('ignores events and resynced streams for a chat another machine owns', async () => {
    assignChatsToMachine(OTHER_MACHINE_ID, [chatId]);
    seedLists(remote);
    queryClient.setQueryData(queryKeys.chat(chatId), makeChat(chatId));
    const source = await mount(remote);
    machineStreams.mockResolvedValue([
      { chat_id: chatId, message_id: 'm1', stream_id: null, last_seq: 0 },
    ]);

    source.emit(JSON.stringify({ kind: 'chat_created', chat: makeChat(chatId, { title: 'x' }) }));
    source.emit(JSON.stringify({ kind: 'title_updated', chat_id: chatId, title: 'new title' }));
    source.emit(streamStarted(chatId));

    expect(queryClient.getQueryData(queryKeys.chat(chatId))).toEqual(makeChat(chatId));
    expect(isInvalidated(remote.chatsKey)).toBe(false);
    expect(useUIStore.getState().chatTabs).toEqual([]);

    source.reconnect();

    await waitFor(() => expect(isInvalidated(remote.chatsKey)).toBe(true));
    await waitFor(() => expect(machineStreams).toHaveBeenCalledTimes(2));
    expect(trackedStreams()).toEqual([]);
  });
});
