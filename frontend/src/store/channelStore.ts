import { create } from 'zustand';
import type {
  ChannelEnvelope,
  ChannelMessage,
  ChannelPermissionRequest,
} from '@/types/channel.types';

interface ChannelSlice {
  messages: Record<string, ChannelMessage>;
  // Highest seq below which REST history is known contiguous; only REST syncs advance it.
  syncedSeq: number;
  synced: boolean;
  permissions: ChannelPermissionRequest[];
  permissionSync: PermissionSync | null;
}

interface PermissionSync {
  token: number;
  received: ReadonlySet<string>;
  resolved: ReadonlySet<string>;
}

interface ChannelState {
  channels: Record<string, ChannelSlice>;
  // Bumped on every SSE (re)open so the open channel refetches what it missed.
  streamEpoch: number;
  holdChannel: (channelId: string) => void;
  releaseChannel: (channelId: string) => void;
  bumpStreamEpoch: () => void;
  mergeMessages: (channelId: string, messages: ChannelMessage[]) => void;
  syncMessages: (channelId: string, messages: ChannelMessage[]) => void;
  beginPermissionSync: (channelId: string) => number;
  syncPermissions: (
    channelId: string,
    token: number,
    permissions: ChannelPermissionRequest[],
  ) => void;
  dropPermission: (channelId: string, memberId: string, requestId: string) => void;
  applyEnvelope: (envelope: ChannelEnvelope) => void;
}

export const EMPTY_MESSAGES: Record<string, ChannelMessage> = {};
export const EMPTY_PERMISSIONS: ChannelPermissionRequest[] = [];

const EMPTY_SLICE: ChannelSlice = {
  messages: EMPTY_MESSAGES,
  syncedSeq: 0,
  synced: false,
  permissions: EMPTY_PERMISSIONS,
  permissionSync: null,
};

let lastSyncToken = 0;

function upsert(slice: ChannelSlice, incoming: ChannelMessage[]): ChannelSlice {
  const messages = { ...slice.messages };
  for (const message of incoming) {
    if (message.version > (messages[message.id]?.version ?? 0)) messages[message.id] = message;
  }
  return { ...slice, messages };
}

function permissionKey(memberId: string, requestId: string): string {
  return `${memberId}:${requestId}`;
}

function keyOf(permission: ChannelPermissionRequest): string {
  return permissionKey(permission.member_id, permission.request.request_id);
}

function withKey(keys: ReadonlySet<string>, key: string): ReadonlySet<string> {
  return new Set(keys).add(key);
}

function withoutKey(keys: ReadonlySet<string>, key: string): ReadonlySet<string> {
  return new Set([...keys].filter((k) => k !== key));
}

function addPermission(slice: ChannelSlice, permission: ChannelPermissionRequest): ChannelSlice {
  const key = keyOf(permission);
  const sync = slice.permissionSync;
  return {
    ...slice,
    permissions: [...slice.permissions.filter((p) => keyOf(p) !== key), permission],
    permissionSync: sync && {
      ...sync,
      received: withKey(sync.received, key),
      resolved: withoutKey(sync.resolved, key),
    },
  };
}

function removePermission(slice: ChannelSlice, memberId: string, requestId: string): ChannelSlice {
  const key = permissionKey(memberId, requestId);
  const sync = slice.permissionSync;
  return {
    ...slice,
    permissions: slice.permissions.filter((p) => keyOf(p) !== key),
    permissionSync: sync && {
      ...sync,
      received: withoutKey(sync.received, key),
      resolved: withKey(sync.resolved, key),
    },
  };
}

function mergeSnapshot(
  slice: ChannelSlice,
  sync: PermissionSync,
  snapshot: ChannelPermissionRequest[],
): ChannelSlice {
  const restored = snapshot.filter(
    (p) => !sync.received.has(keyOf(p)) && !sync.resolved.has(keyOf(p)),
  );
  const live = slice.permissions.filter((p) => sync.received.has(keyOf(p)));
  return { ...slice, permissions: [...restored, ...live], permissionSync: null };
}

function applyToSlice(slice: ChannelSlice, envelope: ChannelEnvelope): ChannelSlice {
  switch (envelope.kind) {
    case 'channel_message':
      return upsert(slice, [envelope.payload.message]);
    case 'channel_permission_request':
      return addPermission(slice, envelope.payload);
    case 'channel_permission_resolved':
      return removePermission(slice, envelope.payload.member_id, envelope.payload.request_id);
  }
}

function withSlice(
  state: ChannelState,
  channelId: string,
  update: (slice: ChannelSlice) => ChannelSlice,
): Partial<ChannelState> {
  const slice = state.channels[channelId];
  if (!slice) return state;
  return { channels: { ...state.channels, [channelId]: update(slice) } };
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: {},
  streamEpoch: 0,

  holdChannel: (channelId) =>
    set((state) =>
      channelId in state.channels
        ? state
        : { channels: { ...state.channels, [channelId]: EMPTY_SLICE } },
    ),

  releaseChannel: (channelId) =>
    set((state) => ({
      channels: Object.fromEntries(
        Object.entries(state.channels).filter(([id]) => id !== channelId),
      ),
    })),

  bumpStreamEpoch: () => set((state) => ({ streamEpoch: state.streamEpoch + 1 })),

  mergeMessages: (channelId, messages) =>
    set((state) => withSlice(state, channelId, (slice) => upsert(slice, messages))),

  syncMessages: (channelId, messages) =>
    set((state) =>
      withSlice(state, channelId, (slice) => ({
        ...upsert(slice, messages),
        syncedSeq: Math.max(slice.syncedSeq, ...messages.map((message) => message.seq)),
        synced: true,
      })),
    ),

  beginPermissionSync: (channelId) => {
    const token = ++lastSyncToken;
    set((state) =>
      withSlice(state, channelId, (slice) => ({
        ...slice,
        permissionSync: { token, received: new Set(), resolved: new Set() },
      })),
    );
    return token;
  },

  syncPermissions: (channelId, token, permissions) =>
    set((state) =>
      withSlice(state, channelId, (slice) =>
        slice.permissionSync?.token === token
          ? mergeSnapshot(slice, slice.permissionSync, permissions)
          : slice,
      ),
    ),

  dropPermission: (channelId, memberId, requestId) =>
    set((state) =>
      withSlice(state, channelId, (slice) => removePermission(slice, memberId, requestId)),
    ),

  applyEnvelope: (envelope) =>
    set((state) => withSlice(state, envelope.channelId, (slice) => applyToSlice(slice, envelope))),
}));
