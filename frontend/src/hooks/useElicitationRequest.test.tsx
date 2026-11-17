// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ElicitationRequest } from '@/types/chat.types';

const h = vi.hoisted(() => ({
  notifyQuestion: vi.fn(),
  notifyBackground: vi.fn(),
}));

vi.mock('@/utils/notifications', () => ({ notifyQuestion: h.notifyQuestion }));
vi.mock('@/hooks/useBackgroundNotify', () => ({ useBackgroundNotify: () => h.notifyBackground }));

import { useElicitationRequest } from './useElicitationRequest';
import { useElicitationStore } from '@/store/elicitationStore';

const request: ElicitationRequest = {
  request_id: 'elicit-1',
  message: 'Which branch?',
  tool_call_id: null,
  requested_schema: { type: 'object', properties: {} },
};

beforeEach(() => {
  vi.clearAllMocks();
  useElicitationStore.setState({ pendingRequests: new Map() });
});

describe('useElicitationRequest', () => {
  it('notifies a new question once as a question, with the chat sub-thread status', () => {
    const { result } = renderHook(() => useElicitationRequest('chat-1', true));

    act(() => result.current.handleElicitationRequest(request));
    act(() => result.current.handleElicitationRequest(request));

    expect(h.notifyBackground).toHaveBeenCalledTimes(1);
    expect(h.notifyBackground).toHaveBeenCalledWith(
      '/chat/chat-1',
      'notify_questions',
      true,
      expect.any(Function),
    );
    const [, , , notifyFn] = h.notifyBackground.mock.calls[0];
    const onClick = vi.fn();
    notifyFn({ onClick });
    expect(h.notifyQuestion).toHaveBeenCalledWith('Which branch?', { onClick });
  });
});
