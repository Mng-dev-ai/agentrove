// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePermissionStore } from './permissionStore';
import { syncChatStatus } from '@/services/chatStatusSync';
import { addResolvedPermission } from '@/utils/permissionStorage';
import type { PermissionRequest } from '@/types/chat.types';

const { checkChatStatus } = vi.hoisted(() => ({ checkChatStatus: vi.fn() }));
vi.mock('@/services/chatService', () => ({ chatService: { checkChatStatus } }));

const request = (id: string, seq = 0): PermissionRequest => ({
  request_id: id,
  tool_name: 'Bash',
  tool_input: {},
  options: [],
  seq,
});

const queueOf = (chatId: string) => usePermissionStore.getState().pendingRequests.get(chatId);
const idsOf = (chatId: string) => queueOf(chatId)?.map((r) => r.request_id);

beforeEach(() => {
  usePermissionStore.setState({ pendingRequests: new Map() });
  localStorage.clear();
});

describe('enqueuePermissionRequest', () => {
  it('preserves FIFO order across multiple requests', () => {
    const enqueue = usePermissionStore.getState().enqueuePermissionRequest;
    enqueue('c1', request('r1'));
    enqueue('c1', request('r2'));
    enqueue('c1', request('r3'));
    expect(idsOf('c1')).toEqual(['r1', 'r2', 'r3']);
  });

  it('reports a replayed request_id as not added and keeps the first envelope', () => {
    const enqueue = usePermissionStore.getState().enqueuePermissionRequest;
    expect(enqueue('c1', request('r1'))).toBe(true);
    expect(enqueue('c1', request('r1', 5))).toBe(false);
    expect(queueOf('c1')).toHaveLength(1);
    expect(queueOf('c1')?.[0].seq).toBe(0);
  });
});

describe('resolvePermissionRequest', () => {
  it('removes the matching request while keeping the rest', () => {
    const enqueue = usePermissionStore.getState().enqueuePermissionRequest;
    enqueue('c1', request('r1'));
    enqueue('c1', request('r2'));
    usePermissionStore.getState().resolvePermissionRequest('c1', 'r1');
    expect(idsOf('c1')).toEqual(['r2']);
  });

  it('deletes the chat bucket once its last request resolves', () => {
    usePermissionStore.getState().enqueuePermissionRequest('c1', request('r1'));
    usePermissionStore.getState().resolvePermissionRequest('c1', 'r1');
    expect(usePermissionStore.getState().pendingRequests.has('c1')).toBe(false);
  });

  it('keeps the map reference for an unknown request or chat', () => {
    usePermissionStore.getState().enqueuePermissionRequest('c1', request('r1'));
    const before = usePermissionStore.getState().pendingRequests;
    usePermissionStore.getState().resolvePermissionRequest('c1', 'missing');
    usePermissionStore.getState().resolvePermissionRequest('missing', 'r1');
    expect(usePermissionStore.getState().pendingRequests).toBe(before);
  });
});

describe('reconcilePermissionRequests', () => {
  const reconcile = (requests: PermissionRequest[], knownIds: string[] = []) =>
    usePermissionStore.getState().reconcilePermissionRequests('c1', requests, new Set(knownIds));

  it('adds a server-pending request missing locally', () => {
    reconcile([request('r1', 11)]);
    expect(queueOf('c1')).toEqual([request('r1', 11)]);
  });

  it('does not re-add a request already answered locally', () => {
    addResolvedPermission('c1', 11);
    reconcile([request('r1', 11)]);
    expect(usePermissionStore.getState().pendingRequests.has('c1')).toBe(false);
  });

  it('does not re-add a known request removed locally during the poll', () => {
    reconcile([request('r1', 11)], ['r1']);
    expect(usePermissionStore.getState().pendingRequests.has('c1')).toBe(false);
  });

  it('falls back to remove-only for ids-only status responses', async () => {
    const enqueue = usePermissionStore.getState().enqueuePermissionRequest;
    enqueue('c1', request('r1'));
    enqueue('c1', request('r2'));
    checkChatStatus.mockResolvedValue({
      has_active_task: true,
      pending_permission_ids: ['r2', 'r3'],
    });
    await syncChatStatus('c1', () => true);
    expect(idsOf('c1')).toEqual(['r2']);
  });
});
