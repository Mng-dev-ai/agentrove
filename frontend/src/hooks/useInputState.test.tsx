// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useInputState } from './useInputState';

describe('useInputState', () => {
  it('restores unsent text for the same chat after a remount and never for another chat', () => {
    const first = renderHook(() => useInputState({ chatId: 'chat-a' }));
    act(() => first.result.current.setInputMessage('draft for a'));
    first.unmount();

    expect(renderHook(() => useInputState({ chatId: 'chat-a' })).result.current.inputMessage).toBe(
      'draft for a',
    );
    expect(renderHook(() => useInputState({ chatId: 'chat-b' })).result.current.inputMessage).toBe(
      '',
    );
  });

  it('forgets the text once the composer is cleared', () => {
    const first = renderHook(() => useInputState({ chatId: 'chat-c' }));
    act(() => first.result.current.setInputMessage('sent soon'));
    act(() => first.result.current.clearInput());
    first.unmount();

    expect(renderHook(() => useInputState({ chatId: 'chat-c' })).result.current.inputMessage).toBe(
      '',
    );
  });

  it('forgets the text when a clear lands after the composer unmounted', () => {
    const first = renderHook(() => useInputState({ chatId: 'chat-d' }));
    act(() => first.result.current.setInputMessage('/btw question'));
    const { setInputMessage } = first.result.current;
    first.unmount();
    act(() => setInputMessage(''));

    expect(renderHook(() => useInputState({ chatId: 'chat-d' })).result.current.inputMessage).toBe(
      '',
    );
  });
});
