// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComposerSelection } from '@/store/uiStore';
import type { AgentKind } from '@/types/chat.types';

const h = vi.hoisted(() => ({
  queueMessage: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
  clearComposerSelections: vi.fn(),
  removeComposerSelection: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { error: h.toastError } }));
vi.mock('@/store/messageQueueStore', () => ({
  useMessageQueueStore: { getState: () => ({ queueMessage: h.queueMessage }) },
}));
vi.mock('@/store/uiStore', () => ({
  useUIStore: {
    getState: () => ({
      clearComposerSelections: h.clearComposerSelections,
      removeComposerSelection: h.removeComposerSelection,
    }),
  },
}));
vi.mock('@/store/chatSettingsStore', () => ({
  useChatSettingsStore: {
    getState: () => ({
      permissionModeByChat: {},
      thinkingModeByChat: {},
      worktreeByChat: {},
      personaByChat: {},
    }),
  },
  DEFAULT_PERMISSION_MODE: 'bypassPermissions',
  DEFAULT_THINKING_MODE: 'high',
  DEFAULT_WORKTREE: false,
  DEFAULT_PERSONA: 'Default',
}));

import { useInputSubmit } from './useInputSubmit';

function makeOptions(overrides: Record<string, unknown> = {}) {
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
    agentKind: 'claude' as AgentKind,
    personas: [],
    attachedSelections: [] as ComposerSelection[],
    attachedFiles: null,
    messageRef: { current: 'hello' },
    setMessage: vi.fn(),
    onAttach: vi.fn(),
    formRef: { current: null } as React.RefObject<HTMLFormElement | null>,
    textareaRef: { current: null } as React.RefObject<HTMLTextAreaElement | null>,
    handleMentionKeyDown: vi.fn(() => false),
    handleSlashCommandKeyDown: vi.fn(() => false),
    ...overrides,
  } as Parameters<typeof useInputSubmit>[0];
}

function formEvent() {
  return { preventDefault: vi.fn() } as unknown as React.FormEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useInputSubmit — handleSubmit', () => {
  it('submits content and dismisses the preview', () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useInputSubmit(opts));
    const e = formEvent();
    act(() => result.current.handleSubmit(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(opts.setPreviewDismissed).toHaveBeenCalledWith(true);
    expect(opts.onSubmit).toHaveBeenCalledWith(e);
  });

  it('bails when disabled', () => {
    const opts = makeOptions({ disabled: true });
    const { result } = renderHook(() => useInputSubmit(opts));
    act(() => result.current.handleSubmit(formEvent()));
    expect(opts.onSubmit).not.toHaveBeenCalled();
  });

  it('bails when there is no content', () => {
    const opts = makeOptions({ hasContent: false });
    const { result } = renderHook(() => useInputSubmit(opts));
    act(() => result.current.handleSubmit(formEvent()));
    expect(opts.onSubmit).not.toHaveBeenCalled();
  });
});

describe('useInputSubmit — submitOrStop stop paths', () => {
  it('stops the stream when streaming with an empty composer', () => {
    const opts = makeOptions({ isStreaming: true, hasContent: false });
    const { result } = renderHook(() => useInputSubmit(opts));
    act(() => result.current.submitOrStop());
    expect(opts.onStopStream).toHaveBeenCalledTimes(1);
    expect(h.queueMessage).not.toHaveBeenCalled();
  });

  it('stops the pending start when loading', () => {
    const opts = makeOptions({ isLoading: true, hasContent: false });
    const { result } = renderHook(() => useInputSubmit(opts));
    act(() => result.current.submitOrStop());
    expect(opts.onStopStream).toHaveBeenCalledTimes(1);
  });
});

describe('useInputSubmit — submitOrStop queue path', () => {
  it('queues the message, clears the draft, and dismisses the preview', () => {
    const opts = makeOptions({ isStreaming: true, hasContent: true });
    const { result } = renderHook(() => useInputSubmit(opts));
    act(() => result.current.submitOrStop());

    expect(h.queueMessage).toHaveBeenCalledTimes(1);
    const [chatId, message, modelId] = h.queueMessage.mock.calls[0];
    expect(chatId).toBe('chat-1');
    expect(message).toBe('hello');
    expect(modelId).toBe('model-1');
    expect(opts.setMessage).toHaveBeenCalledWith('');
    expect(opts.onAttach).toHaveBeenCalledWith([]);
    expect(opts.setPreviewDismissed).toHaveBeenCalledWith(true);
  });

  it('refuses to queue and warns when no model is selected — the draft survives', () => {
    const opts = makeOptions({ isStreaming: true, hasContent: true, selectedModelId: '' });
    const { result } = renderHook(() => useInputSubmit(opts));
    act(() => result.current.submitOrStop());

    expect(h.toastError).toHaveBeenCalledWith('Please select an AI model');
    expect(h.queueMessage).not.toHaveBeenCalled();
    expect(opts.setMessage).not.toHaveBeenCalled();
  });

  it('clears composer selections only when some are attached', () => {
    const selections = [{ text: 'foo.ts', kind: 'file' }] as unknown as ComposerSelection[];
    const opts = makeOptions({
      isStreaming: true,
      hasContent: true,
      attachedSelections: selections,
    });
    const { result } = renderHook(() => useInputSubmit(opts));
    act(() => result.current.submitOrStop());
    expect(h.clearComposerSelections).toHaveBeenCalledWith('chat-1');
  });
});

describe('useInputSubmit — submitOrStop send path', () => {
  it('requestSubmits the form when idle with content', () => {
    const requestSubmit = vi.fn();
    const form = { requestSubmit } as unknown as HTMLFormElement;
    const opts = makeOptions({ formRef: { current: form } });
    const { result } = renderHook(() => useInputSubmit(opts));
    act(() => result.current.submitOrStop());
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(opts.setPreviewDismissed).toHaveBeenCalledWith(true);
  });

  it('falls back to a synthetic submit event when the form lacks requestSubmit', () => {
    const opts = makeOptions({ formRef: { current: null } });
    const { result } = renderHook(() => useInputSubmit(opts));
    act(() => result.current.submitOrStop());
    expect(opts.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled and not streaming', () => {
    const opts = makeOptions({ disabled: true });
    const { result } = renderHook(() => useInputSubmit(opts));
    act(() => result.current.submitOrStop());
    expect(opts.onSubmit).not.toHaveBeenCalled();
    expect(opts.onStopStream).not.toHaveBeenCalled();
  });
});

describe('useInputSubmit — keyboard handling', () => {
  it('Enter without shift submits; suggestion handlers get first refusal', () => {
    const opts = makeOptions({
      formRef: { current: { requestSubmit: vi.fn() } as unknown as HTMLFormElement },
    });
    const { result } = renderHook(() => useInputSubmit(opts));
    const e = {
      key: 'Enter',
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<Element>;
    act(() => result.current.handleKeyDown(e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(opts.handleMentionKeyDown).toHaveBeenCalled();
    expect(opts.handleSlashCommandKeyDown).toHaveBeenCalled();
  });

  it('lets a mention-menu handler swallow Enter without submitting', () => {
    const opts = makeOptions({ handleMentionKeyDown: vi.fn(() => true) });
    const { result } = renderHook(() => useInputSubmit(opts));
    const e = {
      key: 'Enter',
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<Element>;
    act(() => result.current.handleKeyDown(e));
    expect(opts.handleSlashCommandKeyDown).not.toHaveBeenCalled();
    expect(opts.onSubmit).not.toHaveBeenCalled();
  });

  it('Shift+Enter inserts a newline (no submit)', () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useInputSubmit(opts));
    const e = {
      key: 'Enter',
      shiftKey: true,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<Element>;
    act(() => result.current.handleKeyDown(e));
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(opts.onSubmit).not.toHaveBeenCalled();
  });
});

describe('useInputSubmit — selection removal', () => {
  it('removes a selection by index for the active chat', () => {
    const opts = makeOptions();
    const { result } = renderHook(() => useInputSubmit(opts));
    act(() => result.current.handleRemoveSelection(2));
    expect(h.removeComposerSelection).toHaveBeenCalledWith('chat-1', 2);
  });

  it('is a no-op without a chatId', () => {
    const opts = makeOptions({ chatId: undefined });
    const { result } = renderHook(() => useInputSubmit(opts));
    act(() => result.current.handleRemoveSelection(0));
    expect(h.removeComposerSelection).not.toHaveBeenCalled();
  });
});
