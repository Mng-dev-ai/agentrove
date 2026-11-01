// @vitest-environment jsdom

import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';
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

describe('useInputSubmit — handleSubmit', () => {
  it('submits content and dismisses the preview', () => {
    const { opts, result } = render();
    const e = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    act(() => result.current.handleSubmit(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(opts.setPreviewDismissed).toHaveBeenCalledWith(true);
    expect(opts.onSubmit).toHaveBeenCalledWith(e);
  });

  it.each([
    ['disabled', { disabled: true }],
    ['empty', { hasContent: false }],
  ])('does not submit when %s', (_label, overrides) => {
    const { opts, result } = render(overrides);
    act(() => result.current.handleSubmit({ preventDefault: vi.fn() } as never));
    expect(opts.onSubmit).not.toHaveBeenCalled();
  });
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
  it('queues the message, clears the draft, and dismisses the preview', async () => {
    const { opts, result } = render({ isStreaming: true });
    act(() => result.current.submitOrStop());

    expect(opts.setMessage).toHaveBeenCalledWith('');
    expect(opts.onAttach).toHaveBeenCalledWith([]);
    expect(opts.setPreviewDismissed).toHaveBeenCalledWith(true);
    await waitFor(() => expect(queuedContents()).toEqual(['hello']));
    expect(queueMessage).toHaveBeenCalledWith(
      'chat-1',
      'hello',
      'model-1',
      expect.objectContaining({ sendNow: false }),
    );
  });

  it('threads the per-chat worktree and base branch into the queued options', async () => {
    useChatSettingsStore.getState().setWorktree('chat-1', true);
    useChatSettingsStore.getState().setWorktreeBaseBranch('chat-1', 'develop');
    const { result } = render({ isStreaming: true });
    act(() => result.current.submitOrStop());

    await waitFor(() => expect(queueMessage).toHaveBeenCalledTimes(1));
    expect(queueMessage.mock.calls[0][3]).toMatchObject({ worktree: true, baseBranch: 'develop' });
  });

  it('refuses to queue and warns when no model is selected — the draft survives', () => {
    const toastError = vi.spyOn(toast, 'error');
    const { opts, result } = render({ isStreaming: true, selectedModelId: '' });
    act(() => result.current.submitOrStop());

    expect(toastError).toHaveBeenCalledWith('Please select an AI model');
    expect(opts.setMessage).not.toHaveBeenCalled();
    expect(queuedContents()).toEqual([]);
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
  it('requestSubmits the form when idle with content', () => {
    const { requestSubmit, formRef } = fakeForm();
    const { opts, result } = render({ formRef });
    act(() => result.current.submitOrStop());
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(opts.setPreviewDismissed).toHaveBeenCalledWith(true);
  });

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
  it('Enter without shift submits the form', () => {
    const { requestSubmit, formRef } = fakeForm();
    const { result } = render({ formRef });
    const e = keyDown('Enter');
    act(() => result.current.handleKeyDown(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(requestSubmit).toHaveBeenCalledTimes(1);
  });

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

describe('useInputSubmit — selection removal', () => {
  it('removes a selection by index for the active chat', () => {
    const other: ComposerSelection = { kind: 'chat', text: 'other' };
    useUIStore.getState().addComposerSelection('chat-1', selection);
    useUIStore.getState().addComposerSelection('chat-1', other);
    const { result } = render();
    act(() => result.current.handleRemoveSelection(0));
    expect(useUIStore.getState().composerSelectionsByChat['chat-1']).toEqual([other]);
  });
});
