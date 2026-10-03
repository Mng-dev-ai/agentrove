import { useQuery } from '@tanstack/react-query';
import { channelService } from '@/services/channelService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
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
  (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.channelsAll }),
);

export const usePostChannelMessageMutation = createMutation<
  ChannelMessage,
  Error,
  { channelId: string; content: string }
>(
  ({ channelId, content }) => channelService.postMessage(channelId, content),
  () => undefined,
);

export const useStopChannelMutation = createMutation<void, Error, string>(
  (channelId) => channelService.stopChannel(channelId),
  () => undefined,
);
