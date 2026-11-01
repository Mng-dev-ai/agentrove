import { describe, it, expect, beforeEach } from 'vitest';
import { useChannelStore } from './channelStore';
import type {
  ChannelMemberActivity,
  ChannelMessage,
  ChannelPermissionRequest,
} from '@/types/channel.types';

const CH = 'ch1';

const message = (id: string, seq: number, version: number, content = id): ChannelMessage => ({
  id,
  channel_id: CH,
  seq,
  version,
  author_type: 'agent',
  member_id: 'm1',
  content,
  status: 'completed',
  audience: null,
  attachments: [],
  tool_call_count: 0,
  duration_ms: null,
  created_at: '2026-01-01T00:00:00Z',
});

const permission = (memberId: string, requestId: string): ChannelPermissionRequest => ({
  member_id: memberId,
  chat_id: `chat-${memberId}`,
  request: { request_id: requestId, tool_name: 'Bash', tool_input: {}, options: [] },
});

const activity = (epoch: string, version: number, memberIds: string[]): ChannelMemberActivity => ({
  epoch,
  version,
  member_ids: memberIds,
  waiting_member_ids: [],
  retrying_member_ids: [],
});

const store = () => useChannelStore.getState();
const slice = () => store().channels[CH];
const permissionKeys = () =>
  slice().permissions.map((p) => `${p.member_id}:${p.request.request_id}`);

const requestLive = (p: ChannelPermissionRequest) =>
  store().applyEnvelope({ channelId: CH, kind: 'channel_permission_request', payload: p });
const resolveLive = (memberId: string, requestId: string) =>
  store().applyEnvelope({
    channelId: CH,
    kind: 'channel_permission_resolved',
    payload: { member_id: memberId, request_id: requestId },
  });

beforeEach(() => {
  useChannelStore.setState({ channels: {}, activity: {}, streamEpoch: 0 });
});

describe('channel messages', () => {
  it('drops message updates for channels that are not held', () => {
    store().applyEnvelope({
      channelId: CH,
      kind: 'channel_message',
      payload: { message: message('a', 1, 1) },
    });
    store().syncMessages(CH, [message('a', 1, 1)]);
    expect(store().channels).toEqual({});
  });

  it('keeps the highest version when updates arrive out of order', () => {
    store().holdChannel(CH);
    store().applyEnvelope({
      channelId: CH,
      kind: 'channel_message',
      payload: { message: message('a', 1, 3, 'final') },
    });
    store().mergeMessages(CH, [message('a', 1, 2, 'stale')]);
    expect(slice().messages.a.content).toBe('final');

    store().holdChannel(CH);
    expect(slice().messages.a.content).toBe('final');
  });

  it('only advances the synced watermark on REST syncs', () => {
    store().holdChannel(CH);
    store().mergeMessages(CH, [message('live', 9, 1)]);
    expect(slice()).toMatchObject({ syncedSeq: 0, synced: false });

    store().syncMessages(CH, [message('a', 4, 1), message('b', 6, 1)]);
    expect(slice()).toMatchObject({ syncedSeq: 6, synced: true });

    store().syncMessages(CH, [message('old', 2, 1)]);
    expect(slice().syncedSeq).toBe(6);
  });
});

describe('channel permission sync', () => {
  beforeEach(() => store().holdChannel(CH));

  it('replaces the previous list with the snapshot while keeping requests that arrived live', () => {
    requestLive(permission('m1', 'gone'));
    const token = store().beginPermissionSync(CH);
    requestLive(permission('m2', 'live'));

    store().syncPermissions(CH, token, [permission('m3', 'snap'), permission('m2', 'live')]);

    expect(permissionKeys()).toEqual(['m3:snap', 'm2:live']);
  });

  it('does not resurrect a request resolved while the snapshot was in flight', () => {
    requestLive(permission('m1', 'r1'));
    const token = store().beginPermissionSync(CH);
    resolveLive('m1', 'r1');

    store().syncPermissions(CH, token, [permission('m1', 'r1')]);

    expect(slice().permissions).toEqual([]);
  });

  it('ignores a snapshot from a superseded sync', () => {
    const stale = store().beginPermissionSync(CH);
    const current = store().beginPermissionSync(CH);

    store().syncPermissions(CH, stale, [permission('m1', 'stale')]);
    expect(slice().permissions).toEqual([]);

    store().syncPermissions(CH, current, [permission('m1', 'fresh')]);
    expect(permissionKeys()).toEqual(['m1:fresh']);
  });

  it('dedupes a re-sent request by member and request id', () => {
    requestLive(permission('m1', 'r1'));
    requestLive(permission('m2', 'r1'));
    requestLive(permission('m1', 'r1'));
    expect(permissionKeys()).toEqual(['m2:r1', 'm1:r1']);
  });
});

describe('channel activity', () => {
  it('ignores stale versions within an epoch but accepts any version from a new epoch', () => {
    store().syncActivity(CH, activity('e1', 5, ['m1']));
    store().applyEnvelope({
      channelId: CH,
      kind: 'channel_member_activity',
      payload: activity('e1', 5, ['stale']),
    });
    expect(store().activity[CH].member_ids).toEqual(['m1']);

    store().syncActivity(CH, activity('e2', 1, ['m2']));
    expect(store().activity[CH].member_ids).toEqual(['m2']);
  });
});
