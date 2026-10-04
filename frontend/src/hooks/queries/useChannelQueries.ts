import { useMutation, useQuery, type Query } from '@tanstack/react-query';
import { channelService } from '@/services/channelService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { useChannelStore } from '@/store/channelStore';
import type { Channel, ChannelCreateRequest, ChannelMessage } from '@/types/channel.types';
import type { Message } from '@/types/chat.types';

export const useChannelsQuery = (workspaceId: string | undefined, enabled: boolean) =>
  useQuery<Channel[]>({
    queryKey: queryKeys.channels(workspaceId),
    queryFn: () => channelService.listChannels(workspaceId),
    enabled,
    staleTime: 30_000,
  });

export const useChannelQuery = (channelId: string | undefined) =>
  useQuery<Channel>({
    queryKey: queryKeys.channel(channelId),
    queryFn: () => channelService.getChannel(channelId!),
    enabled: !!channelId,
  });

const isActivityInProgress = (query: Query<Message>) =>
  query.state.data?.stream_status === 'in_progress';

export const useChannelMessageActivityQuery = (channelId: string, messageId: string) =>
  useQuery<Message>({
    queryKey: queryKeys.channelMessageActivity(channelId, messageId),
    queryFn: () => channelService.getMessageActivity(channelId, messageId),
    staleTime: (query) => (isActivityInProgress(query) ? 0 : Infinity),
    refetchInterval: (query) => (isActivityInProgress(query) ? 1000 : false),
    retry: false,
  });

export const useCreateChannelMutation = createMutation<Channel, Error, ChannelCreateRequest>(
  (data) => channelService.createChannel(data),
  (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.channelsAll }),
);

export const useRenameChannelMutation = createMutation<
  Channel,
  Error,
  { channelId: string; name: string }
>(
  ({ channelId, name }) => channelService.renameChannel(channelId, name),
  (queryClient, channel) => {
    queryClient.setQueryData(queryKeys.channel(channel.id), channel);
    return queryClient.invalidateQueries({ queryKey: queryKeys.channelsAll });
  },
);

export const useDeleteChannelMutation = createMutation<void, Error, string>(
  (channelId) => channelService.deleteChannel(channelId),
  (queryClient, _data, channelId) => {
    queryClient.removeQueries({ queryKey: queryKeys.channel(channelId) });
    useChannelStore.getState().releaseChannel(channelId);
    return queryClient.invalidateQueries({ queryKey: queryKeys.channelsAll });
  },
);

export const usePostChannelMessageMutation = createMutation<
  ChannelMessage,
  Error,
  { channelId: string; content: string; files: File[] }
>(
  ({ channelId, content, files }) => channelService.postMessage(channelId, content, files),
  (_queryClient, message) =>
    useChannelStore.getState().mergeMessages(message.channel_id, [message]),
);

export const useStopChannelMutation = () =>
  useMutation<void, Error, string>({
    mutationFn: (channelId) => channelService.stopChannel(channelId),
  });
