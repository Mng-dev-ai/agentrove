// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useBlockedChatIds } from './useBlockedChatIds';
import { usePermissionStore } from '@/store/permissionStore';
import { useElicitationStore } from '@/store/elicitationStore';
import type { ElicitationRequest, PermissionRequest } from '@/types/chat.types';

const permission = (id: string): PermissionRequest => ({
  request_id: id,
  tool_name: 'Bash',
  tool_input: {},
  options: [],
  seq: 0,
});

const elicitation = (id: string): ElicitationRequest => ({
  request_id: id,
  message: 'Pick one',
  tool_call_id: null,
  requested_schema: { type: 'object', properties: {} },
});

beforeEach(() => {
  usePermissionStore.setState({ pendingRequests: new Map() });
  useElicitationStore.setState({ pendingRequests: new Map() });
});

describe('useBlockedChatIds', () => {
  it('unions chats blocked on permissions with chats blocked on elicitations', () => {
    const { result } = renderHook(() => useBlockedChatIds());
    expect(result.current.size).toBe(0);

    act(() => {
      usePermissionStore.getState().enqueuePermissionRequest('c1', permission('r1'));
      // AskUserQuestion arrives as an elicitation — it must flag the chat too.
      useElicitationStore.getState().enqueueElicitationRequest('c2', elicitation('e1'));
    });
    expect([...result.current].sort()).toEqual(['c1', 'c2']);
  });

  it('unflags a chat only when its last pending request resolves', () => {
    const { result } = renderHook(() => useBlockedChatIds());

    act(() => {
      usePermissionStore.getState().enqueuePermissionRequest('c1', permission('r1'));
      useElicitationStore.getState().enqueueElicitationRequest('c1', elicitation('e1'));
    });
    expect(result.current.has('c1')).toBe(true);

    act(() => usePermissionStore.getState().resolvePermissionRequest('c1', 'r1'));
    expect(result.current.has('c1')).toBe(true);

    act(() => useElicitationStore.getState().resolveElicitationRequest('c1', 'e1'));
    expect(result.current.has('c1')).toBe(false);
  });
});
