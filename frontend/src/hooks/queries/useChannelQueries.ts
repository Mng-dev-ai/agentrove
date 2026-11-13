import { useCallback, useMemo } from 'react';
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type Query,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { channelService } from '@/services/channelService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { useChannelStore } from '@/store/channelStore';
import { useChannelQueueStore } from '@/store/messageQueueStore';
import { useMachineStore, useRemoteMachineIds } from '@/store/machineStore';
import { channelMachineId } from '@/store/machineOrigin';
import { useUIStore } from '@/store/uiStore';
import { logger } from '@/utils/logger';
import type {
  Channel,
  ChannelCreateRequest,
  ChannelMemberCreateRequest,
  ChannelMemberUpdateRequest,
  ChannelMessage,
} from '@/types/channel.types';
import type { Message } from '@/types/chat.types';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';

export interface MachineChannel {
  channel: Channel;
  machineId: string;
}

export const useMachinesChannels = (enabled: boolean) => {
  const remoteIds = useRemoteMachineIds();
  const connections = useMachineStore((state) => state.connections);
  const machineIds = useMemo(() => [LOCAL_MACHINE_ID, ...remoteIds], [remoteIds]);
  const combine = useCallback(
    (results: UseQueryResult<Channel[]>[]): MachineChannel[] =>
      machineIds
        .flatMap((machineId, index) =>
          (results[index]?.data ?? []).map((channel) => ({ channel, machineId })),
        )
        .sort((a, b) => Date.parse(b.channel.updated_at) - Date.parse(a.channel.updated_at)),
    [machineIds],
  );
  return useQueries({
    queries: machineIds.map((machineId) => ({
      queryKey: queryKeys.channels(machineId),
      queryFn: () => channelService.listChannels(machineId),
      enabled:
        enabled && (machineId === LOCAL_MACHINE_ID || connections[machineId]?.status === 'online'),
      staleTime: 30_000,
    })),
    combine,
  });
};

export const useChannelQuery = (channelId: string | undefined) => {
  const queryClient = useQueryClient();
  return useQuery<Channel>({
    queryKey: queryKeys.channel(channelId),
    queryFn: () => channelService.getChannel(channelId!),
    enabled: !!channelId,
    initialData: () =>
      queryClient
        .getQueryData<Channel[]>(queryKeys.channels(channelMachineId(channelId)))
        ?.find((channel) => channel.id === channelId),
    initialDataUpdatedAt: 0,
  });
};

export async function markChannelViewed(
  queryClient: QueryClient,
  channelId: string,
): Promise<void> {
  const listKey = queryKeys.channels(channelMachineId(channelId));
  const cached =
    queryClient.getQueryData<Channel>(queryKeys.channel(channelId)) ??
    queryClient.getQueryData<Channel[]>(listKey)?.find((channel) => channel.id === channelId);
  if (cached?.unread === undefined) return;
  const markRead = (channel: Channel) =>
    channel.id === channelId && channel.unread ? { ...channel, unread: false } : channel;
  queryClient.setQueryData<Channel>(
    queryKeys.channel(channelId),
    (channel) => channel && markRead(channel),
  );
  queryClient.setQueryData<Channel[]>(listKey, (channels) => channels?.map(markRead));

  try {
    await channelService.markChannelViewed(channelId);
  } catch (error) {
    logger.error('Failed to mark channel viewed', 'markChannelViewed', error);
    return;
  }
  void queryClient.invalidateQueries({ queryKey: listKey });
}

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

export const useCreateChannelMutation = createMutation<
  Channel,
  Error,
  { machineId: string; data: ChannelCreateRequest }
>(
  ({ machineId, data }) => channelService.createChannel(machineId, data),
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

export const usePinChannelMutation = createMutation<
  Channel,
  Error,
  { channelId: string; pinned: boolean }
>(
  ({ channelId, pinned }) => channelService.pinChannel(channelId, pinned),
  (queryClient, channel) => {
    queryClient.setQueryData(queryKeys.channel(channel.id), channel);
    return queryClient.invalidateQueries({ queryKey: queryKeys.channelsAll });
  },
);

const replaceChannel = (queryClient: QueryClient, channel: Channel) => {
  queryClient.setQueryData(queryKeys.channel(channel.id), channel);
  return queryClient.invalidateQueries({ queryKey: queryKeys.channelsAll });
};

export const useAddChannelMemberMutation = createMutation<
  Channel,
  Error,
  { channelId: string; data: ChannelMemberCreateRequest }
>(({ channelId, data }) => channelService.addMember(channelId, data), replaceChannel);

export const useUpdateChannelMemberMutation = createMutation<
  Channel,
  Error,
  { channelId: string; memberId: string; data: ChannelMemberUpdateRequest }
>(
  ({ channelId, memberId, data }) => channelService.updateMember(channelId, memberId, data),
  replaceChannel,
);

export const useRemoveChannelMemberMutation = createMutation<
  Channel,
  Error,
  { channelId: string; memberId: string }
>(({ channelId, memberId }) => channelService.removeMember(channelId, memberId), replaceChannel);

export const useDeleteChannelMutation = createMutation<void, Error, string>(
  (channelId) => channelService.deleteChannel(channelId),
  (queryClient, _data, channelId) => {
    const anchorChatId = (
      queryClient.getQueryData<Channel>(queryKeys.channel(channelId)) ??
      queryClient
        .getQueriesData<Channel[]>({ queryKey: queryKeys.channelsAll })
        .flatMap(([, channels]) => channels ?? [])
        .find((channel) => channel.id === channelId)
    )?.anchor_chat_id;
    queryClient.removeQueries({ queryKey: queryKeys.channel(channelId) });
    useChannelStore.getState().releaseChannel(channelId);
    useChannelQueueStore.getState().cleanupChat(channelId);
    // Layout is keyed by channel; editor tabs and terminals by the anchor chat.
    const ui = useUIStore.getState();
    ui.cleanupChat(channelId);
    if (anchorChatId) ui.cleanupChat(anchorChatId);
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
