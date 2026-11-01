// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PermissionRequest } from '@/types/chat.types';
import { usePermissionStore } from '@/store/permissionStore';
import { isPermissionResolved } from './permissionStorage';
import { executePermissionResponse, clearPermissionRequest } from './permissionResponse';

function makeOpts() {
  return {
    setIsLoading: vi.fn(),
    setError: vi.fn(),
    errorMessage: 'fallback',
    clearRequest: vi.fn(),
  };
}

beforeEach(() => {
  localStorage.clear();
  usePermissionStore.setState({ pendingRequests: new Map() });
});

describe('executePermissionResponse', () => {
  it('treats a non-Error 404-shaped rejection as expired: clears the request, sets no error', async () => {
    const opts = makeOpts();
    const result = await executePermissionResponse(async () => {
      throw { status: 404 };
    }, opts);
    expect(result).toBe('expired');
    expect(opts.clearRequest).toHaveBeenCalledTimes(1);
    expect(opts.setError).toHaveBeenCalledTimes(1);
    expect(opts.setError).toHaveBeenCalledWith(null);
  });

  it('falls back to errorMessage when a non-Error without status is thrown', async () => {
    const opts = makeOpts();
    const result = await executePermissionResponse(async () => {
      throw 'plain string';
    }, opts);
    expect(result).toBe('error');
    expect(opts.setError).toHaveBeenLastCalledWith('fallback');
  });
});

describe('clearPermissionRequest', () => {
  const request = (request_id: string) => ({ request_id, tool_name: 'Bash' }) as PermissionRequest;

  it('marks the seq resolved and drops only that request from the chat queue', () => {
    const store = usePermissionStore.getState();
    store.enqueuePermissionRequest('chat-1', request('req-9'));
    store.enqueuePermissionRequest('chat-1', request('req-10'));

    clearPermissionRequest('chat-1', 'req-9', 42);

    expect(isPermissionResolved('chat-1', 42)).toBe(true);
    expect(
      usePermissionStore
        .getState()
        .pendingRequests.get('chat-1')
        ?.map((r) => r.request_id),
    ).toEqual(['req-10']);
  });
});
