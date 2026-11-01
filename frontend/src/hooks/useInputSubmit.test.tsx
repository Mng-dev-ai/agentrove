// @vitest-environment jsdom

import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentKind } from '@/types/chat.types';
import type { UserSettings } from '@/types/user.types';

const { queueMessage } = vi.hoisted(() => ({ queueMessage: vi.fn() }));

vi.mock('@/services/chatService', () => ({
  chatService: { getChat: vi.fn().mockResolvedValue({ id: 'chat-1' }) },
}));
vi.mock('@/services/queueService', () => ({ queueService: { queueMessage } }));

import { useInputSubmit } from './useInputSubmit';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { queryClient as appQueryClient } from '@/lib/queryClient';
import { useChatSettingsStore } from '@/store/chatSettingsStore';
import { useMessageQueueStore } from '@/store/messageQueueStore';
import { useUIStore, type ComposerSelection } from '@/store/uiStore';

const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
);

const selection: ComposerSelection = { kind: 'chat', text: 'quoted' };

function makeOptions(overrides: Partial<Parameters<typeof useInputSubmit>[0]> = {}) {
  return {
    disabled: false,
    hasContent: true,
    onSubmit: vi.fn(),
    setPreviewDismissed: vi.fn(),
    isStreaming: false,
    onStopStream: vi.fn(),
    isLoading: false,
    chatId: 'chat-1',
    selectedModelId: 'model-1',
    selectedModel: undefined,
    agentKind: 'claude' as AgentKind,
    personas: [],
    attachedSelections: [],
    attachedFiles: null,
    messageRef: { current: 'hello' },
    setMessage: vi.fn(),
    onAttach: vi.fn(),
    formRef: { current: null },
    textareaRef: { current: null },
    handleMentionKeyDown: vi.fn(() => false),
    handleSlashCommandKeyDown: vi.fn(() => false),
    ...overrides,
  } satisfies Parameters<typeof useInputSubmit>[0];
}

function render(overrides: Partial<Parameters<typeof useInputSubmit>[0]> = {}) {
  const opts = makeOptions(overrides);
  const { result } = renderHook(() => useInputSubmit(opts), { wrapper });
  return { opts, result };
}

function fakeForm() {
  const requestSubmit = vi.fn();
  return { requestSubmit, formRef: { current: { requestSubmit } as unknown as HTMLFormElement } };
}

function keyDown(key: string, shiftKey = false) {
  return { key, shiftKey, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<Element>;
}

const queuedContents = () =>
  (useMessageQueueStore.getState().queues.get('chat-1') ?? []).map((m) => m.content);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  testQueryClient.clear();
  appQueryClient.setQueryData([queryKeys.settings], {
    auto_steer_queued_messages: false,
  } as UserSettings);
  queueMessage.mockResolvedValue({ id: 'queued-id', send_now_failed: false });
  useMessageQueueStore.setState({ queues: new Map() });
  useUIStore.setState({ composerSelectionsByChat: {} });
  useChatSettingsStore.setState({ worktreeByChat: {}, worktreeBaseBranchByChat: {} });
});

describe('useInputSubmit — submitOrStop stop paths', () => {
  it('stops the stream when streaming with an empty composer', () => {
    const { opts, result } = render({ isStreaming: true, hasContent: false });
    act(() => result.current.submitOrStop());
    expect(opts.onStopStream).toHaveBeenCalledTimes(1);
    expect(queueMessage).not.toHaveBeenCalled();
  });

  it('stops the pending start when loading', () => {
    const { opts, result } = render({ isLoading: true, hasContent: false });
    act(() => result.current.submitOrStop());
    expect(opts.onStopStream).toHaveBeenCalledTimes(1);
  });
});

describe('useInputSubmit — submitOrStop queue path', () => {
  it('threads the per-chat worktree and base branch into the queued options', async () => {
    useChatSettingsStore.getState().setWorktree('chat-1', true);
    useChatSettingsStore.getState().setWorktreeBaseBranch('chat-1', 'develop');
    const { result } = render({ isStreaming: true });
    act(() => result.current.submitOrStop());

    await waitFor(() => expect(queueMessage).toHaveBeenCalledTimes(1));
    expect(queueMessage.mock.calls[0][3]).toMatchObject({ worktree: true, baseBranch: 'develop' });
  });

  it('folds attached selections into the queued message and clears the chips', async () => {
    useUIStore.getState().addComposerSelection('chat-1', selection);
    const { result } = render({ isStreaming: true, attachedSelections: [selection] });
    act(() => result.current.submitOrStop());

    expect(useUIStore.getState().composerSelectionsByChat['chat-1']).toEqual([]);
    await waitFor(() => expect(queuedContents()).toHaveLength(1));
    expect(queuedContents()[0]).toContain('quoted');
    expect(queuedContents()[0]).toMatch(/hello$/);
  });
});

describe('useInputSubmit — submitOrStop send path', () => {
  it('falls back to a synthetic submit event when there is no form', () => {
    const { opts, result } = render();
    act(() => result.current.submitOrStop());
    expect(opts.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled and not streaming', () => {
    const { opts, result } = render({ disabled: true });
    act(() => result.current.submitOrStop());
    expect(opts.onSubmit).not.toHaveBeenCalled();
    expect(opts.onStopStream).not.toHaveBeenCalled();
  });
});

describe('useInputSubmit — keyboard handling', () => {
  it('lets a mention-menu handler swallow Enter without submitting', () => {
    const { requestSubmit, formRef } = fakeForm();
    const { result } = render({ formRef, handleMentionKeyDown: vi.fn(() => true) });
    act(() => result.current.handleKeyDown(keyDown('Enter')));
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it('Shift+Enter inserts a newline (no submit)', () => {
    const { requestSubmit, formRef } = fakeForm();
    const { result } = render({ formRef });
    const e = keyDown('Enter', true);
    act(() => result.current.handleKeyDown(e));
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
  });
});
