// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PermissionRequest } from '@/types/chat.types';

const h = vi.hoisted(() => ({
  respondToPermission: vi.fn<() => Promise<void>>(),
  notifyPermissionRequest: vi.fn(),
  notifyBackground: vi.fn(),
}));

vi.mock('@/services/permissionService', () => ({
  permissionService: { respondToPermission: h.respondToPermission },
}));
vi.mock('@/utils/notifications', () => ({ notifyPermissionRequest: h.notifyPermissionRequest }));
vi.mock('@/hooks/useBackgroundNotify', () => ({ useBackgroundNotify: () => h.notifyBackground }));

import { usePermissionRequest } from './usePermissionRequest';
import { usePermissionStore } from '@/store/permissionStore';
import { addResolvedPermission, isPermissionResolved } from '@/utils/permissionStorage';

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    request_id: 'req-1',
    tool_name: 'Bash',
    tool_input: {},
    options: [],
    seq: 7,
    ...overrides,
  };
}

function enqueue(request: PermissionRequest) {
  usePermissionStore.getState().enqueuePermissionRequest('chat-1', request);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  usePermissionStore.setState({ pendingRequests: new Map() });
  h.respondToPermission.mockResolvedValue();
});

describe('usePermissionRequest', () => {
  it('surfaces the head of the chat queue as pendingRequest', () => {
    const first = makeRequest({ request_id: 'a' });
    enqueue(first);
    enqueue(makeRequest({ request_id: 'b' }));
    const { result } = renderHook(() => usePermissionRequest('chat-1'));
    expect(result.current.pendingRequest).toBe(first);
  });

  it('enqueues and hands a genuinely new request to the background notifier', () => {
    const { result } = renderHook(() => usePermissionRequest('chat-1'));
    const req = makeRequest();
    act(() => result.current.handlePermissionRequest(req));
    expect(result.current.pendingRequest).toBe(req);
    expect(h.notifyBackground).toHaveBeenCalledWith('chat-1', expect.any(Function));

    const [, notifyFn] = h.notifyBackground.mock.calls[0];
    const onClick = vi.fn();
    notifyFn({ onClick });
    expect(h.notifyPermissionRequest).toHaveBeenCalledWith(req, { onClick });
  });

  it('drops requests the user already resolved (no enqueue, no notify)', () => {
    addResolvedPermission('chat-1', 7);
    const { result } = renderHook(() => usePermissionRequest('chat-1'));
    act(() => result.current.handlePermissionRequest(makeRequest({ seq: 7 })));
    expect(result.current.pendingRequest).toBeNull();
    expect(h.notifyBackground).not.toHaveBeenCalled();
  });

  it('does not re-notify a replayed request that is still pending', () => {
    enqueue(makeRequest());
    const { result } = renderHook(() => usePermissionRequest('chat-1'));
    act(() => result.current.handlePermissionRequest(makeRequest()));
    expect(h.notifyBackground).not.toHaveBeenCalled();
  });

  it('approve responds for the pending request, clears it, and records it as resolved', async () => {
    enqueue(makeRequest({ request_id: 'req-9', seq: 42 }));
    const { result } = renderHook(() => usePermissionRequest('chat-1'));

    await act(() => result.current.handleApprove('allow'));

    expect(h.respondToPermission).toHaveBeenCalledWith('chat-1', 'req-9', 'allow');
    expect(result.current.pendingRequest).toBeNull();
    expect(isPermissionResolved('chat-1', 42)).toBe(true);
  });

  it('reject surfaces a server error and keeps the request pending', async () => {
    const req = makeRequest({ request_id: 'req-9', seq: 42 });
    enqueue(req);
    h.respondToPermission.mockRejectedValue(new Error('server down'));
    const { result } = renderHook(() => usePermissionRequest('chat-1'));

    await act(() => result.current.handleReject('deny'));

    expect(h.respondToPermission).toHaveBeenCalledWith('chat-1', 'req-9', 'deny');
    expect(result.current.error).toBe('server down');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.pendingRequest).toBe(req);
  });

  it('approve is a no-op without a pending request', async () => {
    const { result } = renderHook(() => usePermissionRequest('chat-1'));
    await act(() => result.current.handleApprove('allow'));
    expect(h.respondToPermission).not.toHaveBeenCalled();
  });
});
