import { useMutation, useQuery } from '@tanstack/react-query';
import { channelService } from '@/services/channelService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { useChannelStore } from '@/store/channelStore';
import type { Channel, ChannelCreateRequest, ChannelMessage } from '@/types/channel.types';

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

export const useCreateChannelMutation = createMutation<Channel, Error, ChannelCreateRequest>(
  (data) => channelService.createChannel(data),
  (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.channelsAll }),
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
  { channelId: string; content: string }
>(
  ({ channelId, content }) => channelService.postMessage(channelId, content),
  (_queryClient, message) =>
    useChannelStore.getState().mergeMessages(message.channel_id, [message]),
);

export const useStopChannelMutation = () =>
  useMutation<void, Error, string>({
    mutationFn: (channelId) => channelService.stopChannel(channelId),
  });
