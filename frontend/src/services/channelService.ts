import { apiClient } from '@/lib/api';
import { ensureResponse, serviceCall } from '@/services/base/BaseService';
import type {
  Channel,
  ChannelCreateRequest,
  ChannelMemberActivity,
  ChannelMessage,
  ChannelPermissionRequest,
} from '@/types/channel.types';
import type { Message } from '@/types/chat.types';

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

async function renameChannel(channelId: string, name: string): Promise<Channel> {
  return serviceCall(async () => {
    const response = await apiClient.patch<Channel>(`/channels/${channelId}`, { name });
    return ensureResponse(response, 'Failed to rename channel');
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

async function getMessageActivity(channelId: string, messageId: string): Promise<Message> {
  return serviceCall(async () => {
    const response = await apiClient.get<Message>(
      `/channels/${channelId}/messages/${messageId}/activity`,
    );
    return ensureResponse(response, 'Failed to load message activity');
  });
}

async function postMessage(
  channelId: string,
  content: string,
  files: File[],
): Promise<ChannelMessage> {
  return serviceCall(async () => {
    const formData = new FormData();
    formData.append('content', content);
    files.forEach((file) => formData.append('attached_files', file));
    const response = await apiClient.postForm<ChannelMessage>(
      `/channels/${channelId}/messages`,
      formData,
    );
    return ensureResponse(response, 'Failed to send message');
  });
}

async function listPermissions(channelId: string): Promise<ChannelPermissionRequest[]> {
  return serviceCall(async () => {
    const response = await apiClient.get<ChannelPermissionRequest[]>(
      `/channels/${channelId}/permissions`,
    );
    return ensureResponse(response, 'Failed to load channel approvals');
  });
}

async function getMemberActivity(channelId: string): Promise<ChannelMemberActivity> {
  return serviceCall(async () => {
    const response = await apiClient.get<ChannelMemberActivity>(
      `/channels/${channelId}/member-activity`,
    );
    return ensureResponse(response, 'Failed to load channel activity');
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
  renameChannel,
  deleteChannel,
  listMessages,
  getMessageActivity,
  postMessage,
  listPermissions,
  getMemberActivity,
  stopChannel,
};
