import { create } from 'zustand';
import type { ChannelEnvelope, ChannelMessage } from '@/types/channel.types';

interface ChannelSlice {
  messages: Record<string, ChannelMessage>;
  // Highest seq below which REST history is known contiguous; only REST syncs advance it.
  syncedSeq: number;
  tombstones: Record<string, true>;
  // liveClock value when each message last arrived over SSE or a POST response.
  liveStamps: Record<string, number>;
}

interface ChannelState {
  channels: Record<string, ChannelSlice>;
  liveClock: number;
  // Bumped on every SSE (re)open so the open channel refetches what it missed.
  streamEpoch: number;
  holdChannel: (channelId: string) => void;
  releaseChannel: (channelId: string) => void;
  bumpStreamEpoch: () => void;
  mergeMessages: (channelId: string, messages: ChannelMessage[]) => void;
  syncMessages: (
    channelId: string,
    afterSeq: number,
    messages: ChannelMessage[],
    requestClock: number,
  ) => void;
  applyEnvelope: (envelope: ChannelEnvelope) => void;
}

export const EMPTY_MESSAGES: Record<string, ChannelMessage> = {};

const EMPTY_SLICE: ChannelSlice = {
  messages: EMPTY_MESSAGES,
  syncedSeq: 0,
  tombstones: {},
  liveStamps: {},
};

function omit<T>(record: Record<string, T>, ids: Iterable<string>): Record<string, T> {
  const drop = new Set(ids);
  return Object.fromEntries(Object.entries(record).filter(([id]) => !drop.has(id)));
}

function upsert(
  slice: ChannelSlice,
  incoming: ChannelMessage[],
  liveStamp: number | null,
): ChannelSlice {
  const messages = { ...slice.messages };
  const liveStamps = { ...slice.liveStamps };
  for (const message of incoming) {
    if (message.id in slice.tombstones) continue;
    if (message.version <= (messages[message.id]?.version ?? 0)) continue;
    messages[message.id] = message;
    if (liveStamp !== null) liveStamps[message.id] = liveStamp;
  }
  return { ...slice, messages, liveStamps };
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
  liveClock: 0,
  streamEpoch: 0,

  holdChannel: (channelId) =>
    set((state) =>
      channelId in state.channels
        ? state
        : { channels: { ...state.channels, [channelId]: EMPTY_SLICE } },
    ),

  releaseChannel: (channelId) => set((state) => ({ channels: omit(state.channels, [channelId]) })),

  bumpStreamEpoch: () => set((state) => ({ streamEpoch: state.streamEpoch + 1 })),

  mergeMessages: (channelId, messages) =>
    set((state) => ({
      ...withSlice(state, channelId, (slice) => upsert(slice, messages, state.liveClock + 1)),
      liveClock: state.liveClock + 1,
    })),

  syncMessages: (channelId, afterSeq, messages, requestClock) =>
    set((state) =>
      withSlice(state, channelId, (slice) => {
        const merged = upsert(slice, messages, null);
        const returnedIds = new Set(messages.map((message) => message.id));
        const maxSeq = Math.max(afterSeq, ...messages.map((message) => message.seq));
        const vanished = Object.values(merged.messages)
          .filter(
            (message) =>
              message.seq > afterSeq &&
              message.seq <= maxSeq &&
              !returnedIds.has(message.id) &&
              (merged.liveStamps[message.id] ?? 0) <= requestClock,
          )
          .map((message) => message.id);
        return {
          ...merged,
          messages: omit(merged.messages, vanished),
          liveStamps: omit(merged.liveStamps, vanished),
          tombstones: {
            ...merged.tombstones,
            ...Object.fromEntries(vanished.map((id) => [id, true as const])),
          },
          syncedSeq: Math.max(slice.syncedSeq, maxSeq),
        };
      }),
    ),

  applyEnvelope: (envelope) =>
    set((state) => {
      const clock = state.liveClock + 1;
      const patch = withSlice(state, envelope.channelId, (slice) => {
        if (envelope.kind === 'channel_message') {
          return upsert(slice, [envelope.payload.message], clock);
        }
        const id = envelope.payload.message_id;
        return {
          ...slice,
          messages: omit(slice.messages, [id]),
          liveStamps: omit(slice.liveStamps, [id]),
          tombstones: { ...slice.tombstones, [id]: true },
        };
      });
      return { ...patch, liveClock: clock };
    }),
}));
