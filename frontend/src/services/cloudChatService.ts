import { remoteApiClient, setCloudApiBaseUrl, trimTrailingSlash } from '@/lib/api';
import { ensureResponse, serviceCall, buildQueryString } from '@/services/base/BaseService';
import { buildChatFormData } from '@/services/chatService';
import { cloudAuthStorage } from '@/utils/storage';
import { markCloudChats, markCloudSandboxes, clearCloudOrigins } from '@/utils/chatOrigin';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import type { AuthResponse, UserSettings } from '@/types/user.types';
import type { Workspace, WorkspaceResources } from '@/types/workspace.types';
import type { Chat, ChatRequest, CreateChatRequest } from '@/types/chat.types';
import type { PaginatedChats, PaginatedResponse } from '@/types/api.types';

// Log into the VPS and persist its refresh token. The remote client mints
// access tokens from it on demand, so the desktop stays connected across restarts.
async function connect(url: string, email: string, password: string): Promise<void> {
  // Store the URL slash-trimmed — consumers compose paths like `${cloudUrl}/chat/{id}`.
  const trimmedUrl = trimTrailingSlash(url);
  setCloudApiBaseUrl(trimmedUrl);
  const formData = new FormData();
  formData.append('username', email);
  formData.append('password', password);

  const response = await remoteApiClient.postForm<AuthResponse>('/auth/jwt/login', formData);
  const auth = ensureResponse(response, 'Failed to connect to cloud instance');

  cloudAuthStorage.setRefreshToken(auth.refresh_token);
  cloudAuthStorage.setAccessToken(auth.access_token);
  useCloudSettingsStore.getState().setCloud(trimmedUrl, email);
}

function disconnect(): void {
  cloudAuthStorage.clear();
  clearCloudOrigins();
  useCloudSettingsStore.getState().clearCloud();
}

// List chats on the VPS and register their chat + sandbox IDs as cloud-owned so
// chatService and sandboxService route their reads, status checks, SSE streams,
// stops, files, git, and terminal back to the VPS.
async function listChats(params?: {
  page?: number;
  per_page?: number;
  workspace_id?: string;
}): Promise<PaginatedChats> {
  return serviceCall(async () => {
    const queryString = buildQueryString(params);
    const response = await remoteApiClient.get<PaginatedChats>(`/chat/chats${queryString}`);
    const data = ensureResponse(response, 'Failed to load cloud chats');
    markCloudChats(data.items.map((chat) => chat.id));
    markCloudSandboxes(
      data.items.map((chat) => chat.sandbox_id).filter((id): id is string => !!id),
    );
    return data;
  });
}

async function listWorkspaces(): Promise<Workspace[]> {
  return serviceCall(async () => {
    const response = await remoteApiClient.get<PaginatedResponse<Workspace>>('/workspaces');
    const workspaces = ensureResponse(response, 'Failed to load cloud workspaces').items;
    // Register sandbox IDs as cloud-owned so per-sandbox calls (git, files,
    // terminal) route to the VPS, not the local backend.
    markCloudSandboxes(workspaces.map((ws) => ws.sandbox_id).filter((id): id is string => !!id));
    return workspaces;
  });
}

async function createChat(data: CreateChatRequest): Promise<Chat> {
  return serviceCall(async () => {
    const response = await remoteApiClient.post<Chat>('/chat/chats', data);
    return ensureResponse(response, 'Failed to create cloud chat');
  });
}

// Fetch a VPS workspace's skills and builtin slash-commands. The landing
// composer needs these before a chat exists, so there's no chatId to route by —
// call the VPS directly instead of going through resolveChatClient.
async function getWorkspaceResources(workspaceId: string): Promise<WorkspaceResources> {
  return serviceCall(async () => {
    const response = await remoteApiClient.get<WorkspaceResources>(
      `/workspaces/${workspaceId}/resources`,
    );
    return ensureResponse(response, 'Failed to fetch cloud workspace resources');
  });
}

// Fetch VPS user settings. Only personas are consumed from the landing page —
// the local settings (env vars, GitHub token, etc.) are separate. The VPS runs
// the same backend, so the endpoint shape matches.
async function getSettings(): Promise<UserSettings> {
  return serviceCall(async () => {
    const response = await remoteApiClient.get<UserSettings>('/settings/');
    return ensureResponse(response, 'Failed to fetch cloud settings');
  });
}

// Start the run on the VPS. The desktop doesn't consume the stream — the VPS
// owns and persists it.
async function startCompletion(request: ChatRequest): Promise<void> {
  await serviceCall(async () => {
    await remoteApiClient.postForm('/chat/chat', buildChatFormData(request));
  });
}

export const cloudChatService = {
  connect,
  disconnect,
  listWorkspaces,
  listChats,
  createChat,
  getWorkspaceResources,
  getSettings,
  startCompletion,
};
