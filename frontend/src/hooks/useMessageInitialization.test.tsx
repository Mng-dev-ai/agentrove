// @vitest-environment jsdom

import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMessageInitialization } from './useMessageInitialization';
import { chatStorage } from '@/utils/storage';
import type { Message } from '@/types/chat.types';

type Params = Parameters<typeof useMessageInitialization>[0];
type Props = Omit<Params, 'setMessages' | 'setInitialPrompt'>;

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
    is_bot: false,
    attachments: [],
    created_at: '2026-01-01T00:00:00Z',
    model_id: 'model-1',
    duration_ms: null,
    checkpoint_id: null,
    ...overrides,
  } as Message;
}

const defaults: Props = {
  fetchedMessages: [],
  chatId: 'c1',
  selectedModelId: 'model-1',
  initialPromptFromRoute: null,
  initialPromptSent: false,
  wasAborted: false,
  attachedFiles: [],
  isLoading: false,
  isStreaming: false,
};

function renderInit(overrides: Partial<Props> = {}, seed: Message[] = []) {
  const setInitialPrompt = vi.fn();
  const hook = renderHook(
    (props: Props) => {
      const [messages, setMessages] = useState<Message[]>(seed);
      useMessageInitialization({ ...props, setMessages, setInitialPrompt });
      return { messages, setMessages };
    },
    { initialProps: { ...defaults, ...overrides } },
  );
  return { ...hook, setInitialPrompt };
}

beforeEach(() => {
  localStorage.clear();
});

describe('useMessageInitialization', () => {
  it('normalizes fetched messages into local state, deriving is_bot from role', () => {
    const { result } = renderInit({ fetchedMessages: [makeMessage({ is_bot: false })] });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ id: 'm1', is_bot: true });
  });

  it('persists the highest last_seq for stream-reconnect resumption', () => {
    renderInit({
      fetchedMessages: [
        makeMessage({ id: 'a', last_seq: 3 }),
        makeMessage({ id: 'b', last_seq: 8 }),
      ],
    });
    expect(chatStorage.getEventId('c1')).toBe('8');
  });

  it('while loading, only inserts missing fetched messages and keeps live ones', () => {
    const live = makeMessage({ content_text: 'live content' });
    const { result } = renderInit(
      { fetchedMessages: [makeMessage(), makeMessage({ id: 'm2' })], isLoading: true },
      [live],
    );

    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(result.current.messages[0]).toBe(live);
    expect(chatStorage.getEventId('c1')).toBeNull();
  });

  it('does not re-seed after an abort', () => {
    const { result } = renderInit({ fetchedMessages: [makeMessage()], wasAborted: true });
    expect(result.current.messages).toEqual([]);
  });

  it('injects a synthetic user message for the initial-prompt flow, once', () => {
    const { result, rerender, setInitialPrompt } = renderInit({
      initialPromptFromRoute: 'draft an email',
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content_text: 'draft an email',
    });
    expect(setInitialPrompt).toHaveBeenCalledWith('draft an email');

    const injected = result.current.messages[0];
    rerender({ ...defaults, initialPromptFromRoute: 'draft an email', fetchedMessages: [] });
    expect(result.current.messages).toEqual([injected]);
    expect(setInitialPrompt).toHaveBeenCalledTimes(1);
  });

  it('skips the initial-prompt injection until a model is selected', () => {
    const { result, setInitialPrompt } = renderInit({
      initialPromptFromRoute: 'draft an email',
      selectedModelId: null,
    });
    expect(result.current.messages).toEqual([]);
    expect(setInitialPrompt).not.toHaveBeenCalled();
  });

  it('does not re-inject once the initial prompt was already sent', () => {
    const { result } = renderInit({
      initialPromptFromRoute: 'draft an email',
      initialPromptSent: true,
    });
    expect(result.current.messages).toEqual([]);
  });

  it('while streaming, merges new fetched messages without clobbering live state', () => {
    const { result, rerender } = renderInit({ fetchedMessages: [makeMessage()] });
    const live = makeMessage({ content_text: 'live content' });
    act(() => result.current.setMessages([live]));

    const streamingProps = {
      ...defaults,
      fetchedMessages: [makeMessage(), makeMessage({ id: 'm2' })],
      isStreaming: true,
    };
    rerender(streamingProps);
    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(result.current.messages[0]).toBe(live);

    act(() => result.current.setMessages([live]));
    rerender({ ...streamingProps, fetchedMessages: [...streamingProps.fetchedMessages] });
    expect(result.current.messages).toEqual([live]);
  });
});
