import { describe, it, expect, beforeEach } from 'vitest';
import { usePermissionStore } from './permissionStore';
import type { PermissionRequest } from '@/types/chat.types';

const request = (id: string, seq = 0): PermissionRequest => ({
  request_id: id,
  tool_name: 'Bash',
  tool_input: {},
  options: [],
  seq,
});

const queueOf = (chatId: string) => usePermissionStore.getState().pendingRequests.get(chatId);

beforeEach(() => {
  usePermissionStore.setState({ pendingRequests: new Map() });
});

describe('enqueuePermissionRequest', () => {
  it('enqueues a new request and reports it as newly added', () => {
    const added = usePermissionStore.getState().enqueuePermissionRequest('c1', request('r1'));
    expect(added).toBe(true);
    expect(queueOf('c1')?.map((r) => r.request_id)).toEqual(['r1']);
  });

  it('preserves FIFO order across multiple requests', () => {
    const enqueue = usePermissionStore.getState().enqueuePermissionRequest;
    enqueue('c1', request('r1'));
    enqueue('c1', request('r2'));
    enqueue('c1', request('r3'));
    expect(queueOf('c1')?.map((r) => r.request_id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('dedupes by request_id and reports the duplicate as not added', () => {
    const enqueue = usePermissionStore.getState().enqueuePermissionRequest;
    expect(enqueue('c1', request('r1'))).toBe(true);
    expect(enqueue('c1', request('r1', 5))).toBe(false);
    expect(queueOf('c1')?.length).toBe(1);
    // The first envelope wins — the duplicate never overwrites it.
    expect(queueOf('c1')?.[0].seq).toBe(0);
  });

  it('keeps separate queues per chat', () => {
    const enqueue = usePermissionStore.getState().enqueuePermissionRequest;
    enqueue('c1', request('r1'));
    enqueue('c2', request('r2'));
    expect(queueOf('c1')?.map((r) => r.request_id)).toEqual(['r1']);
    expect(queueOf('c2')?.map((r) => r.request_id)).toEqual(['r2']);
  });
});

describe('resolvePermissionRequest', () => {
  it('removes the matching request while keeping the rest', () => {
    const enqueue = usePermissionStore.getState().enqueuePermissionRequest;
    enqueue('c1', request('r1'));
    enqueue('c1', request('r2'));
    usePermissionStore.getState().resolvePermissionRequest('c1', 'r1');
    expect(queueOf('c1')?.map((r) => r.request_id)).toEqual(['r2']);
  });

  it('deletes the chat bucket once its last request resolves', () => {
    usePermissionStore.getState().enqueuePermissionRequest('c1', request('r1'));
    usePermissionStore.getState().resolvePermissionRequest('c1', 'r1');
    expect(usePermissionStore.getState().pendingRequests.has('c1')).toBe(false);
  });

  it('returns the same state when the request id is unknown', () => {
    usePermissionStore.getState().enqueuePermissionRequest('c1', request('r1'));
    const before = usePermissionStore.getState().pendingRequests;
    usePermissionStore.getState().resolvePermissionRequest('c1', 'missing');
    expect(usePermissionStore.getState().pendingRequests).toBe(before);
  });

  it('returns the same state when the chat is unknown', () => {
    const before = usePermissionStore.getState().pendingRequests;
    usePermissionStore.getState().resolvePermissionRequest('missing', 'r1');
    expect(usePermissionStore.getState().pendingRequests).toBe(before);
  });
});
