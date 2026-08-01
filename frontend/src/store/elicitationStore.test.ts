import { describe, it, expect, beforeEach } from 'vitest';
import { useElicitationStore } from './elicitationStore';
import type { ElicitationRequest } from '@/types/chat.types';

const request = (id: string, message = `msg-${id}`): ElicitationRequest => ({
  request_id: id,
  message,
  tool_call_id: null,
  requested_schema: { type: 'object', properties: {} },
});

const queueOf = (chatId: string) => useElicitationStore.getState().pendingRequests.get(chatId);
const idsOf = (chatId: string) => queueOf(chatId)?.map((r) => r.request_id);

beforeEach(() => {
  useElicitationStore.setState({ pendingRequests: new Map() });
});

describe('enqueueElicitationRequest', () => {
  it('preserves FIFO order across concurrent elicitations', () => {
    const enqueue = useElicitationStore.getState().enqueueElicitationRequest;
    enqueue('c1', request('elicit-1'));
    enqueue('c1', request('elicit-2'));
    enqueue('c1', request('elicit-3'));
    expect(idsOf('c1')).toEqual(['elicit-1', 'elicit-2', 'elicit-3']);
  });

  it('ignores a replay of a queued id so typed answers survive', () => {
    const enqueue = useElicitationStore.getState().enqueueElicitationRequest;
    enqueue('c1', request('elicit-1'));
    const head = queueOf('c1')?.[0];
    enqueue('c1', request('elicit-1', 'replayed'));
    expect(queueOf('c1')?.length).toBe(1);
    expect(queueOf('c1')?.[0]).toBe(head);
  });

  it('keeps separate queues per chat', () => {
    const enqueue = useElicitationStore.getState().enqueueElicitationRequest;
    enqueue('c1', request('elicit-1'));
    enqueue('c2', request('elicit-2'));
    expect(idsOf('c1')).toEqual(['elicit-1']);
    expect(idsOf('c2')).toEqual(['elicit-2']);
  });
});

describe('resolveElicitationRequest', () => {
  it('advances to the next form when the head is answered', () => {
    const enqueue = useElicitationStore.getState().enqueueElicitationRequest;
    enqueue('c1', request('elicit-1'));
    enqueue('c1', request('elicit-2'));
    useElicitationStore.getState().resolveElicitationRequest('c1', 'elicit-1');
    expect(idsOf('c1')).toEqual(['elicit-2']);
  });

  it('silently removes a non-head request without disturbing the head', () => {
    const enqueue = useElicitationStore.getState().enqueueElicitationRequest;
    enqueue('c1', request('elicit-1'));
    enqueue('c1', request('elicit-2'));
    enqueue('c1', request('elicit-3'));
    const head = queueOf('c1')?.[0];
    useElicitationStore.getState().resolveElicitationRequest('c1', 'elicit-2');
    expect(idsOf('c1')).toEqual(['elicit-1', 'elicit-3']);
    expect(queueOf('c1')?.[0]).toBe(head);
  });

  it('deletes the chat bucket once its last form resolves', () => {
    useElicitationStore.getState().enqueueElicitationRequest('c1', request('elicit-1'));
    useElicitationStore.getState().resolveElicitationRequest('c1', 'elicit-1');
    expect(useElicitationStore.getState().pendingRequests.has('c1')).toBe(false);
  });

  it('returns the same state for an unknown request or chat', () => {
    useElicitationStore.getState().enqueueElicitationRequest('c1', request('elicit-1'));
    const before = useElicitationStore.getState().pendingRequests;
    useElicitationStore.getState().resolveElicitationRequest('c1', 'missing');
    useElicitationStore.getState().resolveElicitationRequest('missing', 'elicit-1');
    expect(useElicitationStore.getState().pendingRequests).toBe(before);
  });
});

describe('reconcileElicitationRequests', () => {
  it('appends server-listed forms the queue does not have, oldest first', () => {
    useElicitationStore.getState().enqueueElicitationRequest('c1', request('elicit-1'));
    useElicitationStore
      .getState()
      .reconcileElicitationRequests('c1', [
        request('elicit-1'),
        request('elicit-2'),
        request('elicit-3'),
      ]);
    expect(idsOf('c1')).toEqual(['elicit-1', 'elicit-2', 'elicit-3']);
  });

  it('drops queued forms the server no longer lists', () => {
    const enqueue = useElicitationStore.getState().enqueueElicitationRequest;
    enqueue('c1', request('elicit-1'));
    enqueue('c1', request('elicit-2'));
    useElicitationStore.getState().reconcileElicitationRequests('c1', [request('elicit-2')]);
    expect(idsOf('c1')).toEqual(['elicit-2']);
  });

  it('keeps the rendered head object identical so unsubmitted answers survive', () => {
    useElicitationStore.getState().enqueueElicitationRequest('c1', request('elicit-1'));
    const head = queueOf('c1')?.[0];
    useElicitationStore
      .getState()
      .reconcileElicitationRequests('c1', [request('elicit-1', 'refetched'), request('elicit-2')]);
    expect(queueOf('c1')?.[0]).toBe(head);
    expect(queueOf('c1')?.[0].message).toBe('msg-elicit-1');
  });

  it('clears the queue when the server reports no pending forms', () => {
    useElicitationStore.getState().enqueueElicitationRequest('c1', request('elicit-1'));
    useElicitationStore.getState().reconcileElicitationRequests('c1', []);
    expect(useElicitationStore.getState().pendingRequests.has('c1')).toBe(false);
  });

  it('returns the same state when the queue already matches the server', () => {
    useElicitationStore.getState().enqueueElicitationRequest('c1', request('elicit-1'));
    const before = useElicitationStore.getState().pendingRequests;
    useElicitationStore.getState().reconcileElicitationRequests('c1', [request('elicit-1')]);
    expect(useElicitationStore.getState().pendingRequests).toBe(before);
  });

  it('seeds a chat that has no local queue at all', () => {
    useElicitationStore
      .getState()
      .reconcileElicitationRequests('c1', [request('elicit-7'), request('elicit-8')]);
    expect(idsOf('c1')).toEqual(['elicit-7', 'elicit-8']);
  });
});
