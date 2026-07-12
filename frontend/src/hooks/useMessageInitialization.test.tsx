// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '@/types/chat.types';

const { setEventId } = vi.hoisted(() => ({ setEventId: vi.fn() }));

// Only the persistence boundary is mocked; message/fileType normalization stays real.
vi.mock('@/utils/storage', () => ({ chatStorage: { setEventId } }));

import { useMessageInitialization } from './useMessageInitialization';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    chat_id: 'c1',
    content_text: 'hi',
    content_render: null,
    last_seq: 5,
    active_stream_id: null,
    stream_status: 'completed',
    role: 'assistant',
    attachments: [],
    created_at: '2026-01-01T00:00:00Z',
    model_id: 'model-1',
    duration_ms: null,
    checkpoint_id: null,
    ...overrides,
  } as Message;
}

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    fetchedMessages: [] as Message[],
    chatId: 'c1',
    selectedModelId: 'model-1',
    initialPromptFromRoute: null,
    initialPromptSent: false,
    wasAborted: false,
    attachedFiles: [] as File[],
    isLoading: false,
    isStreaming: false,
    setMessages: vi.fn(),
    setInitialPrompt: vi.fn(),
    ...overrides,
  } as Parameters<typeof useMessageInitialization>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useMessageInitialization', () => {
  it('normalizes fetched messages and seeds local state', () => {
    const params = makeParams({
      fetchedMessages: [makeMessage({ role: 'assistant' })],
    });
    renderHook(() => useMessageInitialization(params));

    expect(params.setMessages).toHaveBeenCalledTimes(1);
    const seeded = (params.setMessages as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[];
    expect(seeded[0].id).toBe('m1');
    // is_bot is derived from role, not trusted from the payload.
    expect(seeded[0].is_bot).toBe(true);
  });

  it('persists the highest last_seq for stream-reconnect resumption', () => {
    const params = makeParams({
      fetchedMessages: [
        makeMessage({ id: 'a', last_seq: 3 }),
        makeMessage({ id: 'b', last_seq: 8 }),
      ],
    });
    renderHook(() => useMessageInitialization(params));
    expect(setEventId).toHaveBeenCalledWith('c1', '8');
  });

  it('does not touch state while messages are still loading', () => {
    const params = makeParams({ fetchedMessages: [makeMessage()], isLoading: true });
    renderHook(() => useMessageInitialization(params));
    expect(params.setMessages).not.toHaveBeenCalled();
    expect(setEventId).not.toHaveBeenCalled();
  });

  it('does not re-seed after an abort', () => {
    const params = makeParams({ fetchedMessages: [makeMessage()], wasAborted: true });
    renderHook(() => useMessageInitialization(params));
    expect(params.setMessages).not.toHaveBeenCalled();
  });

  it('injects a synthetic user message for the initial-prompt flow', () => {
    const params = makeParams({
      fetchedMessages: [],
      initialPromptFromRoute: 'draft an email',
      initialPromptSent: false,
    });
    renderHook(() => useMessageInitialization(params));

    const seeded = (params.setMessages as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[];
    expect(seeded).toHaveLength(1);
    expect(seeded[0].role).toBe('user');
    expect(seeded[0].content_text).toBe('draft an email');
    expect(params.setInitialPrompt).toHaveBeenCalledWith('draft an email');
  });

  it('skips the initial-prompt injection until a model is selected', () => {
    const params = makeParams({
      fetchedMessages: [],
      initialPromptFromRoute: 'draft an email',
      selectedModelId: null,
    });
    renderHook(() => useMessageInitialization(params));
    expect(params.setMessages).not.toHaveBeenCalled();
    expect(params.setInitialPrompt).not.toHaveBeenCalled();
  });

  it('does not re-inject once the initial prompt was already sent', () => {
    const params = makeParams({
      fetchedMessages: [],
      initialPromptFromRoute: 'draft an email',
      initialPromptSent: true,
    });
    renderHook(() => useMessageInitialization(params));
    expect(params.setMessages).not.toHaveBeenCalled();
  });

  it('stops reprocessing the same chat while a stream is live', () => {
    const params = makeParams({ fetchedMessages: [makeMessage()] });
    const { rerender } = renderHook((p) => useMessageInitialization(p), { initialProps: params });
    expect(params.setMessages).toHaveBeenCalledTimes(1);

    // Same chat, now streaming with a changed payload — must not clobber live state.
    const streamingParams = makeParams({
      fetchedMessages: [makeMessage({ id: 'm2' })],
      isStreaming: true,
      setMessages: params.setMessages,
    });
    rerender(streamingParams);
    expect(params.setMessages).toHaveBeenCalledTimes(1);
  });
});
