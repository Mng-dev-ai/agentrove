// @vitest-environment jsdom

import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMessageInitialization } from './useMessageInitialization';
import { chatStorage } from '@/utils/storage';
import type { Message } from '@/types/chat.types';
import { makeMessage } from '@/test/fixtures';

type Params = Parameters<typeof useMessageInitialization>[0];
type Props = Omit<Params, 'setMessages' | 'setInitialPrompt'>;

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
    const { result } = renderInit({ fetchedMessages: [makeMessage('m1', { is_bot: false })] });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ id: 'm1', is_bot: true });
  });

  it('persists the highest last_seq for stream-reconnect resumption', () => {
    renderInit({
      fetchedMessages: [makeMessage('a', { last_seq: 3 }), makeMessage('b', { last_seq: 8 })],
    });
    expect(chatStorage.getEventId('c1')).toBe('8');
  });

  it('while loading, only inserts missing fetched messages and keeps live ones', () => {
    const live = makeMessage('m1', { content_text: 'live content' });
    const { result } = renderInit(
      { fetchedMessages: [makeMessage('m1'), makeMessage('m2')], isLoading: true },
      [live],
    );

    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(result.current.messages[0]).toBe(live);
    expect(chatStorage.getEventId('c1')).toBeNull();
  });

  it('does not re-seed after an abort', () => {
    const { result } = renderInit({ fetchedMessages: [makeMessage('m1')], wasAborted: true });
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
    const { result, rerender } = renderInit({ fetchedMessages: [makeMessage('m1')] });
    const live = makeMessage('m1', { content_text: 'live content' });
    act(() => result.current.setMessages([live]));

    const streamingProps = {
      ...defaults,
      fetchedMessages: [makeMessage('m1'), makeMessage('m2')],
      isStreaming: true,
    };
    rerender(streamingProps);
    expect(result.current.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(result.current.messages[0]).toBe(live);

    act(() => result.current.setMessages([live]));
    rerender({ ...streamingProps, fetchedMessages: [...streamingProps.fetchedMessages] });
    expect(result.current.messages).toEqual([live]);
  });

  it('while streaming, settles an earlier turn the fetch reports finished', () => {
    const user1 = makeMessage('u1', { role: 'user', stream_status: 'completed' });
    const user2 = makeMessage('u2', { role: 'user', stream_status: 'completed' });
    const live = makeMessage('a2', { content_text: 'live content' });
    const local = [user1, makeMessage('a1'), user2, live];
    const { result, rerender } = renderInit(
      { fetchedMessages: [user1, makeMessage('a1'), user2, makeMessage('a2')], isStreaming: true },
      local,
    );

    const finished = makeMessage('a1', {
      content_text: 'turn 1 reply',
      stream_status: 'completed',
    });
    rerender({
      ...defaults,
      fetchedMessages: [user1, finished, user2, makeMessage('a2')],
      isStreaming: true,
    });

    expect(result.current.messages[1]).toMatchObject({
      id: 'a1',
      content_text: 'turn 1 reply',
      stream_status: 'completed',
    });
    expect(result.current.messages[3]).toBe(live);
  });
});
