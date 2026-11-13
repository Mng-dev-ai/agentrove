import { getMachineClient, resolveChannelClient } from '@/lib/api';
import { ensureResponse, serviceCall } from '@/services/base/BaseService';
import { useChannelStore } from '@/store/channelStore';
import { assignChannelsToMachine, channelMachineId } from '@/store/machineOrigin';
import type {
  Channel,
  ChannelCreateRequest,
  ChannelMemberActivity,
  ChannelMemberCreateRequest,
  ChannelMemberUpdateRequest,
  ChannelMessage,
  ChannelPermissionRequest,
} from '@/types/channel.types';
import type { Message } from '@/types/chat.types';
import type { QueueAddResponse, QueuedItem } from '@/types/queue.types';

function syncActivities(channels: Channel[]): void {
  const store = useChannelStore.getState();
  for (const channel of channels) store.syncActivity(channel.id, channel.activity);
}

async function listChannels(machineId: string): Promise<Channel[]> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).get<Channel[]>('/channels');
    const channels = ensureResponse(response, 'Failed to load channels');
    assignChannelsToMachine(machineId, channels);
    syncActivities(channels);
    return channels;
  });
}

async function getChannel(channelId: string): Promise<Channel> {
  return serviceCall(async () => {
    const machineId = channelMachineId(channelId);
    const response = await resolveChannelClient(channelId).get<Channel>(`/channels/${channelId}`);
    const channel = ensureResponse(response, 'Failed to load channel');
    assignChannelsToMachine(machineId, [channel]);
    syncActivities([channel]);
    return channel;
  });
}

async function createChannel(machineId: string, data: ChannelCreateRequest): Promise<Channel> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).post<Channel>('/channels', data);
    const channel = ensureResponse(response, 'Failed to create channel');
    assignChannelsToMachine(machineId, [channel]);
    return channel;
  });
}

async function renameChannel(channelId: string, name: string): Promise<Channel> {
  return serviceCall(async () => {
    const response = await resolveChannelClient(channelId).patch<Channel>(
      `/channels/${channelId}`,
      { name },
    );
    return ensureResponse(response, 'Failed to rename channel');
  });
}

async function pinChannel(channelId: string, pinned: boolean): Promise<Channel> {
  return serviceCall(async () => {
    const response = await resolveChannelClient(channelId).patch<Channel>(
      `/channels/${channelId}`,
      { pinned },
    );
    return ensureResponse(response, 'Failed to update pin status');
  });
}

async function addMember(channelId: string, data: ChannelMemberCreateRequest): Promise<Channel> {
  return serviceCall(async () => {
    const response = await resolveChannelClient(channelId).post<Channel>(
      `/channels/${channelId}/members`,
      data,
    );
    const channel = ensureResponse(response, 'Failed to add member');
    assignChannelsToMachine(channelMachineId(channelId), [channel]);
    return channel;
  });
}

async function updateMember(
  channelId: string,
  memberId: string,
  data: ChannelMemberUpdateRequest,
): Promise<Channel> {
  return serviceCall(async () => {
    const response = await resolveChannelClient(channelId).patch<Channel>(
      `/channels/${channelId}/members/${memberId}`,
      data,
    );
    return ensureResponse(response, 'Failed to update member');
  });
}

async function removeMember(channelId: string, memberId: string): Promise<Channel> {
  return serviceCall(async () => {
    const response = await resolveChannelClient(channelId).delete<Channel>(
      `/channels/${channelId}/members/${memberId}`,
    );
    return ensureResponse(response, 'Failed to remove member');
  });
}

async function markChannelViewed(channelId: string): Promise<void> {
  await serviceCall(async () => {
    await resolveChannelClient(channelId).post(`/channels/${channelId}/viewed`);
  });
}

async function deleteChannel(channelId: string): Promise<void> {
  await serviceCall(async () => {
    await resolveChannelClient(channelId).delete(`/channels/${channelId}`);
  });
}

async function listMessages(
  channelId: string,
  page: { after_seq: number } | { before_seq?: number; limit: number },
): Promise<ChannelMessage[]> {
  return serviceCall(async () => {
    const query = new URLSearchParams(
      Object.entries(page).map(([key, value]) => [key, String(value)]),
    );
    const response = await resolveChannelClient(channelId).get<ChannelMessage[]>(
      `/channels/${channelId}/messages?${query}`,
    );
    return ensureResponse(response, 'Failed to load channel messages');
  });
}

async function getMessageActivity(channelId: string, messageId: string): Promise<Message> {
  return serviceCall(async () => {
    const response = await resolveChannelClient(channelId).get<Message>(
      `/channels/${channelId}/messages/${messageId}/activity`,
    );
    return ensureResponse(response, 'Failed to load message activity');
  });
}

function messageForm(content: string, files: File[]): FormData {
  const formData = new FormData();
  formData.append('content', content);
  files.forEach((file) => formData.append('attached_files', file));
  return formData;
}

async function postMessage(
  channelId: string,
  content: string,
  files: File[],
): Promise<ChannelMessage> {
  return serviceCall(async () => {
    const response = await resolveChannelClient(channelId).postForm<ChannelMessage>(
      `/channels/${channelId}/messages`,
      messageForm(content, files),
    );
    return ensureResponse(response, 'Failed to send message');
  });
}

async function queueMessage(
  channelId: string,
  content: string,
  files: File[],
  sendNow?: boolean,
): Promise<QueueAddResponse> {
  return serviceCall(async () => {
    const formData = messageForm(content, files);
    if (sendNow) formData.append('send_now', 'true');
    const response = await resolveChannelClient(channelId).postForm<QueueAddResponse>(
      `/channels/${channelId}/queue`,
      formData,
    );
    return ensureResponse(response, 'Failed to queue message');
  });
}

async function getQueue(channelId: string): Promise<QueuedItem[]> {
  return serviceCall(async () => {
    const response = await resolveChannelClient(channelId).get<QueuedItem[]>(
      `/channels/${channelId}/queue`,
    );
    return ensureResponse(response, 'Failed to fetch queue');
  });
}

async function updateQueuedMessage(
  channelId: string,
  messageId: string,
  content: string,
): Promise<QueuedItem> {
  return serviceCall(async () => {
    const response = await resolveChannelClient(channelId).patch<QueuedItem>(
      `/channels/${channelId}/queue/${messageId}`,
      { content },
    );
    return ensureResponse(response, 'Failed to update queued message');
  });
}

async function deleteQueuedMessage(channelId: string, messageId: string): Promise<void> {
  await serviceCall(async () => {
    await resolveChannelClient(channelId).delete(`/channels/${channelId}/queue/${messageId}`);
  });
}

async function sendQueuedNow(channelId: string, messageId: string): Promise<void> {
  await serviceCall(async () => {
    await resolveChannelClient(channelId).post(
      `/channels/${channelId}/queue/${messageId}/send-now`,
    );
  });
}

async function listPermissions(channelId: string): Promise<ChannelPermissionRequest[]> {
  return serviceCall(async () => {
    const response = await resolveChannelClient(channelId).get<ChannelPermissionRequest[]>(
      `/channels/${channelId}/permissions`,
    );
    return ensureResponse(response, 'Failed to load channel approvals');
  });
}

async function getMemberActivity(channelId: string): Promise<ChannelMemberActivity> {
  return serviceCall(async () => {
    const response = await resolveChannelClient(channelId).get<ChannelMemberActivity>(
      `/channels/${channelId}/member-activity`,
    );
    return ensureResponse(response, 'Failed to load channel activity');
  });
}

async function stopChannel(channelId: string): Promise<void> {
  await serviceCall(async () => {
    await resolveChannelClient(channelId).post(`/channels/${channelId}/stop`);
  });
}

export const channelService = {
  listChannels,
  getChannel,
  createChannel,
  renameChannel,
  pinChannel,
  deleteChannel,
  addMember,
  updateMember,
  removeMember,
  markChannelViewed,
  listMessages,
  getMessageActivity,
  postMessage,
  queueMessage,
  getQueue,
  updateQueuedMessage,
  deleteQueuedMessage,
  sendQueuedNow,
  listPermissions,
  getMemberActivity,
  stopChannel,
};
