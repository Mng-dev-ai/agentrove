import { remoteApiClient, setCloudApiBaseUrl, trimTrailingSlash } from '@/lib/api';
import { ensureResponse, serviceCall, buildQueryString } from '@/services/base/BaseService';
import { buildChatFormData } from '@/services/chatService';
import { cloudAuthStorage } from '@/utils/storage';
import { markCloudChats, markCloudSandboxes, clearCloudOrigins } from '@/utils/chatOrigin';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import type { AuthResponse, UserSettings } from '@/types/user.types';
import type {
  Workspace,
  WorkspaceResources,
  UpdateWorkspaceRequest,
} from '@/types/workspace.types';
import type { Chat, ChatRequest, ChatSearchResponse, CreateChatRequest } from '@/types/chat.types';
import type { ActiveStreamSnapshot } from '@/types/stream.types';
import type { PaginatedChats, PaginatedResponse } from '@/types/api.types';

// Log into the VPS and persist its refresh token for reconnect across restarts.
async function connect(url: string, email: string, password: string): Promise<void> {
  const trimmedUrl = trimTrailingSlash(url);
  // On failed login, restore previous URL so existing cloud chats don't misroute.
  const previousUrl = useCloudSettingsStore.getState().cloudUrl;
  setCloudApiBaseUrl(trimmedUrl);
  const formData = new FormData();
  formData.append('username', email);
  formData.append('password', password);

  let auth: AuthResponse;
  try {
    const response = await remoteApiClient.postForm<AuthResponse>('/auth/jwt/login', formData);
    auth = ensureResponse(response, 'Failed to connect to cloud instance');
  } catch (error) {
    if (previousUrl) setCloudApiBaseUrl(previousUrl);
    throw error;
  }

  await cloudAuthStorage.setTokens(auth.access_token, auth.refresh_token);
  useCloudSettingsStore.getState().setCloud(trimmedUrl, email);
}

function disconnect(): void {
  cloudAuthStorage.clear();
  clearCloudOrigins();
  useCloudSettingsStore.getState().clearCloud();
}

// List VPS chats and mark chat/sandbox IDs cloud-owned for routing.
async function listChats(params?: { page?: number; per_page?: number }): Promise<PaginatedChats> {
  return serviceCall(async () => {
    const queryString = buildQueryString(params);
    const response = await remoteApiClient.get<PaginatedChats>(`/chat/chats${queryString}`);
    const data = ensureResponse(response, 'Failed to load cloud chats');
    markCloudChats(data.items.map((chat) => chat.id));
    markCloudSandboxes(data.items.map((chat) => chat.sandbox_id));
    return data;
  });
}

async function listWorkspaces(): Promise<Workspace[]> {
  return serviceCall(async () => {
    const response = await remoteApiClient.get<PaginatedResponse<Workspace>>('/workspaces');
    const workspaces = ensureResponse(response, 'Failed to load cloud workspaces').items;
    // Mark sandboxes cloud-owned so git/files/terminal hit the VPS.
    markCloudSandboxes(workspaces.map((ws) => ws.sandbox_id).filter((id): id is string => !!id));
    return workspaces;
  });
}

// Search VPS chats (merged with local in the panel); mark results cloud-owned.
async function searchChats(query: string): Promise<ChatSearchResponse> {
  return serviceCall(async () => {
    const queryString = buildQueryString({ q: query });
    const response = await remoteApiClient.get<ChatSearchResponse>(
      `/chat/chats/search${queryString}`,
    );
    const data = ensureResponse(response, 'Failed to search cloud chats');
    markCloudChats(data.results.map((result) => result.chat_id));
    return data;
  });
}

async function createChat(data: CreateChatRequest): Promise<Chat> {
  return serviceCall(async () => {
    const response = await remoteApiClient.post<Chat>('/chat/chats', data);
    return ensureResponse(response, 'Failed to create cloud chat');
  });
}

async function updateWorkspace(
  workspaceId: string,
  data: UpdateWorkspaceRequest,
): Promise<Workspace> {
  return serviceCall(async () => {
    const response = await remoteApiClient.patch<Workspace>(`/workspaces/${workspaceId}`, data);
    return ensureResponse(response, 'Failed to rename cloud workspace');
  });
}

async function deleteWorkspace(workspaceId: string): Promise<void> {
  await serviceCall(async () => {
    await remoteApiClient.delete(`/workspaces/${workspaceId}`);
  });
}

// Cloud half of "Delete All Chats" (sidebar merges local + VPS).
async function deleteAllChats(): Promise<void> {
  await serviceCall(async () => {
    await remoteApiClient.delete('/chat/chats/all');
  });
}

// Landing composer needs skills before a chat exists — call VPS directly.
async function getWorkspaceResources(workspaceId: string): Promise<WorkspaceResources> {
  return serviceCall(async () => {
    const response = await remoteApiClient.get<WorkspaceResources>(
      `/workspaces/${workspaceId}/resources`,
    );
    return ensureResponse(response, 'Failed to fetch cloud workspace resources');
  });
}

// VPS settings (landing uses personas); same endpoint shape as local backend.
async function getSettings(): Promise<UserSettings> {
  return serviceCall(async () => {
    const response = await remoteApiClient.get<UserSettings>('/settings/');
    return ensureResponse(response, 'Failed to fetch cloud settings');
  });
}

// Start a VPS run; the VPS owns the stream (desktop doesn't consume it).
async function startCompletion(request: ChatRequest): Promise<void> {
  await serviceCall(async () => {
    await remoteApiClient.postForm('/chat/chat', buildChatFormData(request));
  });
}

// Bulk active-stream snapshot; mark chat IDs cloud-owned for reconnect routing.
async function getActiveStreams(): Promise<ActiveStreamSnapshot[]> {
  return serviceCall(async () => {
    const response = await remoteApiClient.get<ActiveStreamSnapshot[]>(
      '/chat/chats/active-streams',
    );
    const streams = ensureResponse(response, 'Failed to fetch cloud active streams');
    markCloudChats(streams.map((stream) => stream.chat_id));
    return streams;
  });
}

// VPS chat lifecycle SSE. Mint token up front — EventSource skips 401 refresh.
async function createChatEventsSource(): Promise<EventSource> {
  const token = await remoteApiClient.getValidToken();
  if (!token) {
    throw new Error('Not connected to cloud instance');
  }
  const params = new URLSearchParams({ token });
  return new EventSource(`${remoteApiClient.getBaseUrl()}/chat/chats/events?${params.toString()}`);
}

export const cloudChatService = {
  connect,
  disconnect,
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
