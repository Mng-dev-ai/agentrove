import { getMachineClient } from '@/lib/api';
import { ensureResponse, serviceCall, buildQueryString } from '@/services/base/BaseService';
import { AuthEventSource } from '@/services/authEventSource';
import { buildChatFormData } from '@/services/chatService';
import {
  assignChatRecordsToMachine,
  assignChatsToMachine,
  assignSandboxesToMachine,
} from '@/utils/machineOrigin';
import type { UserSettings } from '@/types/user.types';
import type {
  Workspace,
  WorkspaceResources,
  UpdateWorkspaceRequest,
} from '@/types/workspace.types';
import type { Chat, ChatRequest, ChatSearchResponse, CreateChatRequest } from '@/types/chat.types';
import type { ActiveStreamSnapshot } from '@/types/stream.types';
import type { PaginatedChats, PaginatedResponse } from '@/types/api.types';

async function listChats(
  machineId: string,
  params?: { page?: number; per_page?: number },
): Promise<PaginatedChats> {
  return serviceCall(async () => {
    const queryString = buildQueryString(params);
    const response = await getMachineClient(machineId).get<PaginatedChats>(
      `/chat/chats${queryString}`,
    );
    const data = ensureResponse(response, 'Failed to load chats');
    assignChatRecordsToMachine(machineId, data.items);
    return data;
  });
}

async function listWorkspaces(machineId: string): Promise<Workspace[]> {
  return serviceCall(async () => {
    const response =
      await getMachineClient(machineId).get<PaginatedResponse<Workspace>>('/workspaces');
    const workspaces = ensureResponse(response, 'Failed to load workspaces').items;
    assignSandboxesToMachine(
      machineId,
      workspaces.map((ws) => ws.sandbox_id).filter((id): id is string => !!id),
    );
    return workspaces;
  });
}

async function searchChats(machineId: string, query: string): Promise<ChatSearchResponse> {
  return serviceCall(async () => {
    const queryString = buildQueryString({ q: query });
    const response = await getMachineClient(machineId).get<ChatSearchResponse>(
      `/chat/chats/search${queryString}`,
    );
    const data = ensureResponse(response, 'Failed to search chats');
    assignChatsToMachine(
      machineId,
      data.results.map((result) => result.chat_id),
    );
    return data;
  });
}

async function createChat(machineId: string, data: CreateChatRequest): Promise<Chat> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).post<Chat>('/chat/chats', data);
    const chat = ensureResponse(response, 'Failed to create chat');
    assignChatRecordsToMachine(machineId, [chat]);
    return chat;
  });
}

async function updateWorkspace(
  machineId: string,
  workspaceId: string,
  data: UpdateWorkspaceRequest,
): Promise<Workspace> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).patch<Workspace>(
      `/workspaces/${workspaceId}`,
      data,
    );
    return ensureResponse(response, 'Failed to rename workspace');
  });
}

async function deleteWorkspace(machineId: string, workspaceId: string): Promise<void> {
  await serviceCall(async () => {
    await getMachineClient(machineId).delete(`/workspaces/${workspaceId}`);
  });
}

async function deleteAllChats(machineId: string): Promise<void> {
  await serviceCall(async () => {
    await getMachineClient(machineId).delete('/chat/chats/all');
  });
}

async function getWorkspaceResources(
  machineId: string,
  workspaceId: string,
): Promise<WorkspaceResources> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).get<WorkspaceResources>(
      `/workspaces/${workspaceId}/resources`,
    );
    return ensureResponse(response, 'Failed to fetch workspace resources');
  });
}

async function getSettings(machineId: string): Promise<UserSettings> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).get<UserSettings>('/settings/');
    return ensureResponse(response, 'Failed to fetch settings');
  });
}

async function startCompletion(machineId: string, request: ChatRequest): Promise<void> {
  await serviceCall(async () => {
    await getMachineClient(machineId).postForm('/chat/chat', buildChatFormData(request));
  });
}

async function getActiveStreams(machineId: string): Promise<ActiveStreamSnapshot[]> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).get<ActiveStreamSnapshot[]>(
      '/chat/chats/active-streams',
    );
    const streams = ensureResponse(response, 'Failed to fetch active streams');
    assignChatsToMachine(
      machineId,
      streams.map((stream) => stream.chat_id),
    );
    return streams;
  });
}

async function createChatEventsSource(machineId: string): Promise<AuthEventSource> {
  return new AuthEventSource(getMachineClient(machineId), '/chat/chats/events');
}

export const machineChatService = {
  listWorkspaces,
  updateWorkspace,
  deleteWorkspace,
  listChats,
  searchChats,
  createChat,
  deleteAllChats,
  getWorkspaceResources,
  getSettings,
  startCompletion,
  getActiveStreams,
  createChatEventsSource,
};
