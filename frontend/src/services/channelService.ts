import { apiClient } from '@/lib/api';
import { ensureResponse, serviceCall } from '@/services/base/BaseService';
import type { Channel, ChannelCreateRequest, ChannelMessage } from '@/types/channel.types';

async function listChannels(workspaceId?: string): Promise<Channel[]> {
  return serviceCall(async () => {
    const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
    const response = await apiClient.get<Channel[]>(`/channels${query}`);
    return ensureResponse(response, 'Failed to load channels');
  });
}

async function getChannel(channelId: string): Promise<Channel> {
  return serviceCall(async () => {
    const response = await apiClient.get<Channel>(`/channels/${channelId}`);
    return ensureResponse(response, 'Failed to load channel');
  });
}

async function createChannel(data: ChannelCreateRequest): Promise<Channel> {
  return serviceCall(async () => {
    const response = await apiClient.post<Channel>('/channels', data);
    return ensureResponse(response, 'Failed to create channel');
  });
}

async function deleteChannel(channelId: string): Promise<void> {
  await serviceCall(async () => {
    await apiClient.delete(`/channels/${channelId}`);
  });
}

async function listMessages(channelId: string, afterSeq: number): Promise<ChannelMessage[]> {
  return serviceCall(async () => {
    const response = await apiClient.get<ChannelMessage[]>(
      `/channels/${channelId}/messages?after_seq=${afterSeq}`,
    );
    return ensureResponse(response, 'Failed to load channel messages');
  });
}

async function postMessage(channelId: string, content: string): Promise<ChannelMessage> {
  return serviceCall(async () => {
    const response = await apiClient.post<ChannelMessage>(`/channels/${channelId}/messages`, {
      content,
    });
    return ensureResponse(response, 'Failed to send message');
  });
}

async function stopChannel(channelId: string): Promise<void> {
  await serviceCall(async () => {
    await apiClient.post(`/channels/${channelId}/stop`);
  });
}

export const channelService = {
  listChannels,
  getChannel,
  createChannel,
  deleteChannel,
  listMessages,
  postMessage,
  stopChannel,
};
