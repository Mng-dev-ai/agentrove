// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PermissionRequest } from '@/types/chat.types';

const h = vi.hoisted(() => ({
  storeState: {
    pendingRequests: new Map<string, PermissionRequest[]>(),
    enqueuePermissionRequest: vi.fn(() => true),
  },
  respondToPermission: vi.fn(() => Promise.resolve()),
  isPermissionResolved: vi.fn(() => false),
  notifyPermissionRequest: vi.fn(),
  settings: { data: undefined as { notifications_enabled?: boolean } | undefined },
  executePermissionResponse: vi.fn<
    (
      serviceFn: () => unknown,
      opts: { errorMessage: string; clearRequest: () => void },
    ) => Promise<string>
  >(() => Promise.resolve('success')),
  clearPermissionRequest: vi.fn(),
}));

vi.mock('@/services/permissionService', () => ({
  permissionService: { respondToPermission: h.respondToPermission },
}));
vi.mock('@/store/permissionStore', () => ({
  usePermissionStore: Object.assign(
    (selector: (s: typeof h.storeState) => unknown) => selector(h.storeState),
    { getState: () => h.storeState },
  ),
}));
vi.mock('@/utils/permissionStorage', () => ({ isPermissionResolved: h.isPermissionResolved }));
vi.mock('@/utils/notifications', () => ({ notifyPermissionRequest: h.notifyPermissionRequest }));
vi.mock('@/hooks/queries/useSettingsQueries', () => ({ useSettingsQuery: () => h.settings }));
vi.mock('@/utils/permissionResponse', () => ({
  executePermissionResponse: h.executePermissionResponse,
  clearPermissionRequest: h.clearPermissionRequest,
}));

import { usePermissionRequest } from './usePermissionRequest';

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    request_id: 'req-1',
    seq: 7,
    ...overrides,
  } as PermissionRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.storeState.pendingRequests = new Map();
  h.storeState.enqueuePermissionRequest.mockReturnValue(true);
  h.isPermissionResolved.mockReturnValue(false);
  h.settings.data = undefined;
});

describe('usePermissionRequest', () => {
  it('surfaces the head of the chat queue as pendingRequest', () => {
    const first = makeRequest({ request_id: 'a' });
    h.storeState.pendingRequests.set('chat-1', [first, makeRequest({ request_id: 'b' })]);
    const { result } = renderHook(() => usePermissionRequest('chat-1'));
    expect(result.current.pendingRequest).toBe(first);
  });

  it('reports no pending request when chatId is undefined', () => {
    h.storeState.pendingRequests.set('chat-1', [makeRequest()]);
    const { result } = renderHook(() => usePermissionRequest(undefined));
    expect(result.current.pendingRequest).toBeNull();
  });

  it('enqueues and notifies for a genuinely new request', () => {
    const { result } = renderHook(() => usePermissionRequest('chat-1'));
    const req = makeRequest();
    act(() => result.current.handlePermissionRequest(req));
    expect(h.storeState.enqueuePermissionRequest).toHaveBeenCalledWith('chat-1', req);
    expect(h.notifyPermissionRequest).toHaveBeenCalledWith(req);
  });

  it('drops requests the user already resolved (no enqueue, no notify)', () => {
    h.isPermissionResolved.mockReturnValue(true);
    const { result } = renderHook(() => usePermissionRequest('chat-1'));
    act(() => result.current.handlePermissionRequest(makeRequest()));
    expect(h.storeState.enqueuePermissionRequest).not.toHaveBeenCalled();
    expect(h.notifyPermissionRequest).not.toHaveBeenCalled();
  });

  it('does not notify when the store dedupes the request (added=false)', () => {
    h.storeState.enqueuePermissionRequest.mockReturnValue(false);
    const { result } = renderHook(() => usePermissionRequest('chat-1'));
    act(() => result.current.handlePermissionRequest(makeRequest()));
    expect(h.notifyPermissionRequest).not.toHaveBeenCalled();
  });

  it('does not notify when notifications are disabled in settings', () => {
    h.settings.data = { notifications_enabled: false };
    const { result } = renderHook(() => usePermissionRequest('chat-1'));
    act(() => result.current.handlePermissionRequest(makeRequest()));
    expect(h.storeState.enqueuePermissionRequest).toHaveBeenCalled();
    expect(h.notifyPermissionRequest).not.toHaveBeenCalled();
  });

  it('wires approve to the service and cleanup with the pending request ids', async () => {
    h.storeState.pendingRequests.set('chat-1', [makeRequest({ request_id: 'req-9', seq: 42 })]);
    const { result } = renderHook(() => usePermissionRequest('chat-1'));

    await act(async () => {
      await result.current.handleApprove('allow');
    });

    expect(h.executePermissionResponse).toHaveBeenCalledTimes(1);
    const [serviceFn, opts] = h.executePermissionResponse.mock.calls[0];
    // Invoke the captured closures to confirm they target the right request.
    serviceFn();
    expect(h.respondToPermission).toHaveBeenCalledWith('chat-1', 'req-9', 'allow');
    opts.clearRequest();
    expect(h.clearPermissionRequest).toHaveBeenCalledWith('chat-1', 'req-9', 42);
    expect(opts.errorMessage).toBe('Failed to approve permission');
  });

  it('reject uses its own error message but the same request target', async () => {
    h.storeState.pendingRequests.set('chat-1', [makeRequest({ request_id: 'req-9', seq: 42 })]);
    const { result } = renderHook(() => usePermissionRequest('chat-1'));

    await act(async () => {
      await result.current.handleReject('deny');
    });

    const [serviceFn, opts] = h.executePermissionResponse.mock.calls[0];
    serviceFn();
    expect(h.respondToPermission).toHaveBeenCalledWith('chat-1', 'req-9', 'deny');
    expect(opts.errorMessage).toBe('Failed to reject permission');
  });

  it('approve is a no-op without a pending request', async () => {
    const { result } = renderHook(() => usePermissionRequest('chat-1'));
    await act(async () => {
      await result.current.handleApprove('allow');
    });
    expect(h.executePermissionResponse).not.toHaveBeenCalled();
  });
});
