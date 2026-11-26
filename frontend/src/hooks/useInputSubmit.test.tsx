// @vitest-environment jsdom

import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentKind, Chat, Model } from '@/types/chat.types';
import type { UserSettings } from '@/types/user.types';

const { queueMessage } = vi.hoisted(() => ({ queueMessage: vi.fn() }));

vi.mock('@/services/chatService', () => ({
  chatService: { getChat: vi.fn().mockResolvedValue({ id: 'chat-1' }) },
}));
vi.mock('@/services/queueService', () => ({ queueService: { queueMessage } }));
vi.mock('@/utils/sideQuestion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/sideQuestion')>()),
  startSideQuestion: vi.fn(),
}));

import { useInputSubmit } from './useInputSubmit';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { queryClient as appQueryClient } from '@/lib/queryClient';
import { useChatSettingsStore } from '@/store/chatSettingsStore';
import { useMessageQueueStore } from '@/store/messageQueueStore';
import { useUIStore, type ComposerSelection } from '@/store/uiStore';
import { startSideQuestion } from '@/utils/sideQuestion';

const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
);

const selection: ComposerSelection = { kind: 'chat', text: 'quoted' };
const forkableChat = {
  id: 'chat-1',
  parent_chat_id: null,
  channel_id: null,
  session_agent_kind: 'claude',
  last_model_id: 'sonnet',
} as Chat;
const forkableModel: Model = {
  model_id: 'sonnet',
  name: 'Sonnet',
  agent_kind: 'claude',
  context_window: null,
  thinking_modes: [],
  supports_fork: true,
};

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
    chat: undefined,
    chatModel: undefined,
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

type SubmitOptions = Parameters<typeof useInputSubmit>[0];

function useSubmitWithFiles(opts: SubmitOptions, initialFiles: File[]) {
  const [files, setFiles] = useState(initialFiles);
  const submit = useInputSubmit({ ...opts, attachedFiles: files, onAttach: setFiles });
  return { files, setFiles, submit };
}

function renderWithFiles(opts: SubmitOptions, initialFiles: File[]) {
  return renderHook(() => useSubmitWithFiles(opts, initialFiles), { wrapper });
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
  queueMessage.mockResolvedValue({ id: 'queued-id', send_now_failed: false, started: false });
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

  it('restores failed sent files ahead of files attached while the queue request ran', async () => {
    let failQueue!: (error: Error) => void;
    queueMessage.mockReturnValue(
      new Promise((_, reject) => {
        failQueue = reject;
      }),
    );
    const sent = new File(['a'], 'sent.png', { type: 'image/png' });
    const added = new File(['b'], 'added.png', { type: 'image/png' });
    const { result } = renderWithFiles(makeOptions({ isStreaming: true }), [sent]);
    act(() => result.current.submit.submitOrStop());
    await waitFor(() => expect(queueMessage).toHaveBeenCalledTimes(1));
    expect(result.current.files).toEqual([]);
    act(() => result.current.setFiles((current) => [...current, added]));
    await act(async () => failQueue(new Error('queue failed')));

    expect(result.current.files.map((file) => file.name)).toEqual(['sent.png', 'added.png']);
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

describe('useInputSubmit — /btw side question', () => {
  it('keeps a file added to the composer while the side question was starting', async () => {
    let finishStart!: () => void;
    vi.mocked(startSideQuestion).mockReturnValue(
      new Promise<void>((resolve) => {
        finishStart = resolve;
      }),
    );
    const sent = new File(['a'], 'sent.png', { type: 'image/png' });
    const added = new File(['b'], 'added.png', { type: 'image/png' });
    const opts = makeOptions({
      chat: forkableChat,
      chatModel: forkableModel,
      messageRef: { current: '/btw where is retry?' },
    });
    const { result } = renderWithFiles(opts, [sent]);
    act(() => result.current.submit.submitOrStop());
    act(() => result.current.setFiles((current) => [...current, added]));
    await act(async () => finishStart());

    expect(vi.mocked(startSideQuestion).mock.calls[0][1].attachedFiles).toEqual([sent]);
    expect(result.current.files.map((file) => file.name)).toEqual(['added.png']);
  });
});
