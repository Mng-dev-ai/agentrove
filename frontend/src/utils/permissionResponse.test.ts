import { describe, it, expect, vi, beforeEach } from 'vitest';

const { resolvePermissionRequest, addResolvedPermission } = vi.hoisted(() => ({
  resolvePermissionRequest: vi.fn(),
  addResolvedPermission: vi.fn(),
}));

vi.mock('@/store/permissionStore', () => ({
  usePermissionStore: { getState: () => ({ resolvePermissionRequest }) },
}));
vi.mock('@/utils/permissionStorage', () => ({ addResolvedPermission }));

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
  vi.clearAllMocks();
});

describe('executePermissionResponse', () => {
  it('returns success and clears the request when the service resolves', async () => {
    const opts = makeOpts();
    const result = await executePermissionResponse(async () => {}, opts);
    expect(result).toBe('success');
    expect(opts.clearRequest).toHaveBeenCalledTimes(1);
    expect(opts.setError).toHaveBeenCalledWith(null);
  });

  it('toggles loading on around the call regardless of outcome', async () => {
    const opts = makeOpts();
    await executePermissionResponse(async () => {}, opts);
    expect(opts.setIsLoading).toHaveBeenNthCalledWith(1, true);
    expect(opts.setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it('treats a 404 Error as expired: clears the request, sets no error', async () => {
    const opts = makeOpts();
    const err = Object.assign(new Error('gone'), { status: 404 });
    const result = await executePermissionResponse(async () => {
      throw err;
    }, opts);
    expect(result).toBe('expired');
    expect(opts.clearRequest).toHaveBeenCalledTimes(1);
    // Only the initial reset — the expired branch never sets an error message.
    expect(opts.setError).toHaveBeenCalledTimes(1);
    expect(opts.setError).toHaveBeenCalledWith(null);
    expect(opts.setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it('treats a non-Error 404-shaped rejection as expired', async () => {
    const opts = makeOpts();
    const result = await executePermissionResponse(async () => {
      throw { status: 404 };
    }, opts);
    expect(result).toBe('expired');
    expect(opts.clearRequest).toHaveBeenCalledTimes(1);
  });

  it('surfaces an Error message and does not clear on a non-404 failure', async () => {
    const opts = makeOpts();
    const result = await executePermissionResponse(async () => {
      throw new Error('boom');
    }, opts);
    expect(result).toBe('error');
    expect(opts.setError).toHaveBeenLastCalledWith('boom');
    expect(opts.clearRequest).not.toHaveBeenCalled();
    expect(opts.setIsLoading).toHaveBeenLastCalledWith(false);
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
  it('records the resolved seq then drops the in-memory request', () => {
    clearPermissionRequest('chat-1', 'req-9', 42);
    expect(addResolvedPermission).toHaveBeenCalledWith('chat-1', 42);
    expect(resolvePermissionRequest).toHaveBeenCalledWith('chat-1', 'req-9');
  });
});
