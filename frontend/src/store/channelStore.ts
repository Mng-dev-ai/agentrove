import { create } from 'zustand';
import type { ChannelEnvelope, ChannelMessage } from '@/types/channel.types';

interface ChannelState {
  messagesByChannel: Record<string, Record<string, ChannelMessage>>;
  typingByChannel: Record<string, string[]>;
  openChannelId: string | null;
  // Bumped on every SSE (re)open so the open channel refetches what it missed.
  streamEpoch: number;
  setOpenChannel: (channelId: string | null) => void;
  bumpStreamEpoch: () => void;
  mergeMessages: (channelId: string, messages: ChannelMessage[]) => void;
  applyEnvelope: (envelope: ChannelEnvelope) => void;
  clearChannel: (channelId: string) => void;
}

export const EMPTY_MESSAGES: Record<string, ChannelMessage> = {};
export const EMPTY_TYPING: string[] = [];

// Live deltas outrun a stale refetch: never regress a message that is further along.
function mergeMessage(existing: ChannelMessage | undefined, incoming: ChannelMessage) {
  if (!existing) return incoming;
  if (existing.status !== 'streaming') {
    return incoming.status === 'streaming' ? existing : incoming;
  }
  if (incoming.status === 'streaming' && existing.content.length >= incoming.content.length) {
    return existing;
  }
  return incoming;
}

function withMessages(
  state: ChannelState,
  channelId: string,
  messages: ChannelMessage[],
): Pick<ChannelState, 'messagesByChannel'> {
  const current = state.messagesByChannel[channelId] ?? EMPTY_MESSAGES;
  const next = { ...current };
  for (const message of messages) {
    next[message.id] = mergeMessage(current[message.id], message);
  }
  return { messagesByChannel: { ...state.messagesByChannel, [channelId]: next } };
}

function withMessagePatch(
  state: ChannelState,
  channelId: string,
  messageId: string,
  patch: (message: ChannelMessage) => ChannelMessage,
): Partial<ChannelState> {
  const message = state.messagesByChannel[channelId]?.[messageId];
  if (!message) return state;
  return {
    messagesByChannel: {
      ...state.messagesByChannel,
      [channelId]: { ...state.messagesByChannel[channelId], [messageId]: patch(message) },
    },
  };
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

export const useChannelStore = create<ChannelState>((set) => ({
  messagesByChannel: {},
  typingByChannel: {},
  openChannelId: null,
  streamEpoch: 0,

  setOpenChannel: (channelId) => set({ openChannelId: channelId }),

  bumpStreamEpoch: () => set((state) => ({ streamEpoch: state.streamEpoch + 1 })),

  mergeMessages: (channelId, messages) => set((state) => withMessages(state, channelId, messages)),

  applyEnvelope: (envelope) =>
    set((state) => {
      const { channelId } = envelope;
      switch (envelope.kind) {
        case 'channel_message_created':
        case 'channel_message_completed':
          return withMessages(state, channelId, [envelope.payload.message]);
        case 'channel_message_delta':
          return withMessagePatch(state, channelId, envelope.payload.message_id, (message) => ({
            ...message,
            content: message.content + envelope.payload.delta,
          }));
        case 'channel_message_cancelled':
          return withMessagePatch(state, channelId, envelope.payload.message_id, (message) => ({
            ...message,
            status: 'cancelled',
          }));
        case 'member_typing': {
          const { member_id: memberId, typing } = envelope.payload;
          const others = (state.typingByChannel[channelId] ?? EMPTY_TYPING).filter(
            (id) => id !== memberId,
          );
          return {
            typingByChannel: {
              ...state.typingByChannel,
              [channelId]: typing ? [...others, memberId] : others,
            },
          };
        }
      }
    }),

  clearChannel: (channelId) =>
    set((state) => ({
      messagesByChannel: omitKey(state.messagesByChannel, channelId),
      typingByChannel: omitKey(state.typingByChannel, channelId),
    })),
}));
