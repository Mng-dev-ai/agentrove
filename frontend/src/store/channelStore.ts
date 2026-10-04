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
  syncPermissions: (channelId: string, permissions: ChannelPermissionRequest[]) => void;
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
};

function upsert(slice: ChannelSlice, incoming: ChannelMessage[]): ChannelSlice {
  const messages = { ...slice.messages };
  for (const message of incoming) {
    if (message.version > (messages[message.id]?.version ?? 0)) messages[message.id] = message;
  }
  return { ...slice, messages };
}

function withoutPermission(slice: ChannelSlice, memberId: string, requestId: string): ChannelSlice {
  return {
    ...slice,
    permissions: slice.permissions.filter(
      (p) => p.member_id !== memberId || p.request.request_id !== requestId,
    ),
  };
}

function applyToSlice(slice: ChannelSlice, envelope: ChannelEnvelope): ChannelSlice {
  switch (envelope.kind) {
    case 'channel_message':
      return upsert(slice, [envelope.payload.message]);
    case 'channel_permission_request': {
      const { member_id, request } = envelope.payload;
      return {
        ...slice,
        permissions: [
          ...withoutPermission(slice, member_id, request.request_id).permissions,
          envelope.payload,
        ],
      };
    }
    case 'channel_permission_resolved':
      return withoutPermission(slice, envelope.payload.member_id, envelope.payload.request_id);
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

  syncPermissions: (channelId, permissions) =>
    set((state) => withSlice(state, channelId, (slice) => ({ ...slice, permissions }))),

  dropPermission: (channelId, memberId, requestId) =>
    set((state) =>
      withSlice(state, channelId, (slice) => withoutPermission(slice, memberId, requestId)),
    ),

  applyEnvelope: (envelope) =>
    set((state) => withSlice(state, envelope.channelId, (slice) => applyToSlice(slice, envelope))),
}));
