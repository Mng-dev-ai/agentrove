import { create } from 'zustand';
import type { ActiveStream, StreamMetadata } from '@/types/stream.types';

interface StreamState {
  activeStreams: Map<string, ActiveStream>;
  streamIdByChatMessage: Map<string, string>;
  activeStreamMetadata: StreamMetadata[];
  lastToolTitleByChatId: Map<string, string>;
  completedChatIds: Set<string>;
  markCompleted: (chatId: string) => void;
  clearCompleted: (chatId: string) => void;
  addStream: (stream: ActiveStream) => void;
  removeStream: (streamId: string) => void;
  getStream: (streamId: string) => ActiveStream | undefined;
  getStreamByChatAndMessage: (chatId: string, messageId: string) => ActiveStream | undefined;
  getStreamByChat: (chatId: string) => ActiveStream | undefined;
  updateStreamCallbacks: (
    chatId: string,
    messageId: string,
    callbacks: ActiveStream['callbacks'],
  ) => void;
  updateStreamMessageId: (chatId: string, oldMessageId: string, newMessageId: string) => void;
  abortStream: (streamId: string) => void;
  setLastToolTitle: (chatId: string, title: string) => void;
  removeStreamMetadata: (chatId: string) => void;
  addStreamMetadata: (metadata: StreamMetadata) => void;
  addStreamMetadataIfAbsent: (metadata: StreamMetadata) => void;
}

function getChatMessageKey(chatId: string, messageId: string): string {
  return `${chatId}:${messageId}`;
}

const upsertStreamMetadata = (
  metadata: StreamMetadata[],
  entry: StreamMetadata,
): StreamMetadata[] => {
  const existingIndex = metadata.findIndex((item) => item.chatId === entry.chatId);
  if (existingIndex === -1) {
    return [...metadata, entry];
  }

  const nextMetadata = [...metadata];
  nextMetadata[existingIndex] = entry;
  return nextMetadata;
};

const removeStreamMetadataEntry = (metadata: StreamMetadata[], chatId: string): StreamMetadata[] =>
  metadata.filter((item) => item.chatId !== chatId);

const shutdownStream = (stream: ActiveStream) => {
  // The shared multiplexed connection (streamConnection) reconciles against the
  // store, so dropping the entry is enough — no per-stream socket to close.
  stream.isActive = false;
  stream.callbacks = undefined;
};

export const useStreamStore = create<StreamState>((set, get) => ({
  activeStreams: new Map<string, ActiveStream>(),
  streamIdByChatMessage: new Map<string, string>(),
  activeStreamMetadata: [],
  lastToolTitleByChatId: new Map<string, string>(),
  // Chats whose stream finished successfully since the user last viewed them —
  // drives the sidebar "Done" badge until the chat is opened.
  completedChatIds: new Set<string>(),

  markCompleted: (chatId: string) => {
    set((state) => {
      const next = new Set(state.completedChatIds);
      next.add(chatId);
      return { completedChatIds: next };
    });
  },

  clearCompleted: (chatId: string) => {
    set((state) => {
      if (!state.completedChatIds.has(chatId)) return state;
      const next = new Set(state.completedChatIds);
      next.delete(chatId);
      return { completedChatIds: next };
    });
  },

  addStream: (stream: ActiveStream) => {
    set((state) => {
      const nextStreams = new Map(state.activeStreams);
      const nextIndex = new Map(state.streamIdByChatMessage);

      nextStreams.set(stream.id, stream);
      nextIndex.set(getChatMessageKey(stream.chatId, stream.messageId), stream.id);

      return {
        activeStreams: nextStreams,
        streamIdByChatMessage: nextIndex,
        activeStreamMetadata: upsertStreamMetadata(state.activeStreamMetadata, {
          chatId: stream.chatId,
          messageId: stream.messageId,
          startTime: stream.startTime,
        }),
      };
    });
  },

  removeStream: (streamId: string) => {
    set((state) => {
      const stream = state.activeStreams.get(streamId);
      if (!stream) return state;

      shutdownStream(stream);
      const nextStreams = new Map(state.activeStreams);
      const nextIndex = new Map(state.streamIdByChatMessage);

      nextStreams.delete(streamId);
      nextIndex.delete(getChatMessageKey(stream.chatId, stream.messageId));

      const hasOtherStreamsForChat = Array.from(nextStreams.values()).some(
        (item) => item.chatId === stream.chatId && item.isActive,
      );
      let nextLastToolTitles = state.lastToolTitleByChatId;
      if (!hasOtherStreamsForChat) {
        nextLastToolTitles = new Map(state.lastToolTitleByChatId);
        nextLastToolTitles.delete(stream.chatId);
      }

      return {
        activeStreams: nextStreams,
        streamIdByChatMessage: nextIndex,
        lastToolTitleByChatId: nextLastToolTitles,
        activeStreamMetadata: hasOtherStreamsForChat
          ? state.activeStreamMetadata
          : removeStreamMetadataEntry(state.activeStreamMetadata, stream.chatId),
      };
    });
  },

  getStream: (streamId: string) => get().activeStreams.get(streamId),

  getStreamByChatAndMessage: (chatId: string, messageId: string) => {
    const state = get();
    const streamId = state.streamIdByChatMessage.get(getChatMessageKey(chatId, messageId));
    return streamId ? state.activeStreams.get(streamId) : undefined;
  },

  getStreamByChat: (chatId: string) => {
    const state = get();
    for (const stream of state.activeStreams.values()) {
      if (stream.chatId === chatId && stream.isActive) {
        return stream;
      }
    }
    return undefined;
  },

  updateStreamCallbacks: (
    chatId: string,
    messageId: string,
    callbacks: ActiveStream['callbacks'],
  ) => {
    const stream = get().getStreamByChatAndMessage(chatId, messageId);
    if (stream && stream.isActive) {
      stream.callbacks = callbacks;
    }
  },

  updateStreamMessageId: (chatId: string, oldMessageId: string, newMessageId: string) => {
    set((state) => {
      const streamId = state.streamIdByChatMessage.get(getChatMessageKey(chatId, oldMessageId));
      if (!streamId) return state;

      const stream = state.activeStreams.get(streamId);
      if (!stream) return state;

      // A message-id swap only happens on queue handoff — the stream is reused for a
      // new assistant turn, so restart the clock (thinking timer, cancel duration).
      const updatedStream = { ...stream, messageId: newMessageId, startTime: Date.now() };
      const nextStreams = new Map(state.activeStreams);
      nextStreams.set(streamId, updatedStream);

      const nextIndex = new Map(state.streamIdByChatMessage);
      nextIndex.delete(getChatMessageKey(chatId, oldMessageId));
      nextIndex.set(getChatMessageKey(chatId, newMessageId), streamId);

      // The new turn hasn't run a tool yet — the previous turn's title is stale.
      const nextLastToolTitles = new Map(state.lastToolTitleByChatId);
      nextLastToolTitles.delete(chatId);

      return {
        activeStreams: nextStreams,
        streamIdByChatMessage: nextIndex,
        lastToolTitleByChatId: nextLastToolTitles,
        activeStreamMetadata: upsertStreamMetadata(state.activeStreamMetadata, {
          chatId: stream.chatId,
          messageId: newMessageId,
          startTime: updatedStream.startTime,
        }),
      };
    });
  },

  abortStream: (streamId: string) => {
    get().removeStream(streamId);
  },

  setLastToolTitle: (chatId: string, title: string) => {
    set((state) => {
      const next = new Map(state.lastToolTitleByChatId);
      next.set(chatId, title);
      return { lastToolTitleByChatId: next };
    });
  },

  removeStreamMetadata: (chatId: string) => {
    set((state) => {
      const nextStreams = new Map(state.activeStreams);
      const nextIndex = new Map(state.streamIdByChatMessage);

      for (const [id, stream] of state.activeStreams.entries()) {
        if (stream.chatId === chatId) {
          shutdownStream(stream);
          nextStreams.delete(id);
          nextIndex.delete(getChatMessageKey(stream.chatId, stream.messageId));
        }
      }

      const nextLastToolTitles = new Map(state.lastToolTitleByChatId);
      nextLastToolTitles.delete(chatId);

      return {
        activeStreams: nextStreams,
        streamIdByChatMessage: nextIndex,
        lastToolTitleByChatId: nextLastToolTitles,
        activeStreamMetadata: removeStreamMetadataEntry(state.activeStreamMetadata, chatId),
      };
    });
  },

  addStreamMetadata: (metadata: StreamMetadata) => {
    set((state) => {
      return {
        activeStreamMetadata: upsertStreamMetadata(state.activeStreamMetadata, metadata),
      };
    });
  },

  addStreamMetadataIfAbsent: (metadata: StreamMetadata) => {
    // Unlike addStreamMetadata's upsert, an already-tracked chat keeps its entry —
    // restoration and event feeds must not reset a live stream's startTime.
    set((state) =>
      state.activeStreamMetadata.some((item) => item.chatId === metadata.chatId)
        ? state
        : { activeStreamMetadata: [...state.activeStreamMetadata, metadata] },
    );
  },
}));
