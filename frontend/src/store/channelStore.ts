import { create } from 'zustand';
import type { ChannelEnvelope, ChannelMessage } from '@/types/channel.types';

interface ChannelState {
  messagesByChannel: Record<string, Record<string, ChannelMessage>>;
  // Bumped on every SSE (re)open so the open channel refetches what it missed.
  streamEpoch: number;
  holdChannel: (channelId: string) => void;
  releaseChannel: (channelId: string) => void;
  bumpStreamEpoch: () => void;
  mergeMessages: (channelId: string, messages: ChannelMessage[]) => void;
  applyEnvelope: (envelope: ChannelEnvelope) => void;
}

export const EMPTY_MESSAGES: Record<string, ChannelMessage> = {};

function withMessages(
  state: ChannelState,
  channelId: string,
  messages: ChannelMessage[],
): Pick<ChannelState, 'messagesByChannel'> {
  const current = state.messagesByChannel[channelId] ?? EMPTY_MESSAGES;
  const next = { ...current };
  for (const message of messages) {
    if (message.version > (current[message.id]?.version ?? 0)) next[message.id] = message;
  }
  return { messagesByChannel: { ...state.messagesByChannel, [channelId]: next } };
}

export const useChannelStore = create<ChannelState>((set) => ({
  messagesByChannel: {},
  streamEpoch: 0,

  holdChannel: (channelId) =>
    set((state) =>
      channelId in state.messagesByChannel
        ? state
        : { messagesByChannel: { ...state.messagesByChannel, [channelId]: EMPTY_MESSAGES } },
    ),

  releaseChannel: (channelId) =>
    set((state) => ({
      messagesByChannel: Object.fromEntries(
        Object.entries(state.messagesByChannel).filter(([id]) => id !== channelId),
      ),
    })),

  bumpStreamEpoch: () => set((state) => ({ streamEpoch: state.streamEpoch + 1 })),

  mergeMessages: (channelId, messages) => set((state) => withMessages(state, channelId, messages)),

  applyEnvelope: (envelope) =>
    set((state) => {
      const { channelId } = envelope;
      if (!(channelId in state.messagesByChannel)) return state;
      if (envelope.kind === 'channel_message') {
        return withMessages(state, channelId, [envelope.payload.message]);
      }
      const rest = Object.fromEntries(
        Object.entries(state.messagesByChannel[channelId]).filter(
          ([id]) => id !== envelope.payload.message_id,
        ),
      );
      return { messagesByChannel: { ...state.messagesByChannel, [channelId]: rest } };
    }),
}));
