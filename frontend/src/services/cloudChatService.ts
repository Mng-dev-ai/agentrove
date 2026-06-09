import { remoteApiClient, setCloudApiBaseUrl, trimTrailingSlash } from '@/lib/api';
import { ensureResponse, serviceCall } from '@/services/base/BaseService';
import { buildChatFormData } from '@/services/chatService';
import { cloudAuthStorage } from '@/utils/storage';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import type { AuthResponse } from '@/types/user.types';
import type { Workspace } from '@/types/workspace.types';
import type { Chat, ChatRequest, CreateChatRequest } from '@/types/chat.types';
import type { PaginatedResponse } from '@/types/api.types';

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
  useCloudSettingsStore.getState().clearCloud();
}

async function listWorkspaces(): Promise<Workspace[]> {
  return serviceCall(async () => {
    const response = await remoteApiClient.get<PaginatedResponse<Workspace>>('/workspaces');
    return ensureResponse(response, 'Failed to load cloud workspaces').items;
  });
}

async function createChat(data: CreateChatRequest): Promise<Chat> {
  return serviceCall(async () => {
    const response = await remoteApiClient.post<Chat>('/chat/chats', data);
    return ensureResponse(response, 'Failed to create cloud chat');
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
  createChat,
  startCompletion,
};
