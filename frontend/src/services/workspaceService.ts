import { apiClient, resolveChatClient } from '@/lib/api';
import { ensureResponse, serviceCall, buildQueryString } from '@/services/base/BaseService';
import type {
  Workspace,
  WorkspaceResources,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
} from '@/types/workspace.types';
import type { PaginationParams, PaginatedResponse } from '@/types/api.types';

async function listWorkspaces(
  pagination?: PaginationParams,
): Promise<PaginatedResponse<Workspace>> {
  return serviceCall(async () => {
    const queryString = buildQueryString(pagination ? { ...pagination } : undefined);
    const response = await apiClient.get<PaginatedResponse<Workspace>>(`/workspaces${queryString}`);
    return ensureResponse(response, 'Failed to fetch workspaces');
  });
}

async function createWorkspace(data: CreateWorkspaceRequest): Promise<Workspace> {
  return serviceCall(async () => {
    const response = await apiClient.post<Workspace>('/workspaces', data);
    return ensureResponse(response, 'Failed to create workspace');
  });
}

async function updateWorkspace(
  workspaceId: string,
  data: UpdateWorkspaceRequest,
): Promise<Workspace> {
  return serviceCall(async () => {
    const response = await apiClient.patch<Workspace>(`/workspaces/${workspaceId}`, data);
    return ensureResponse(response, 'Failed to update workspace');
  });
}

async function deleteWorkspace(workspaceId: string): Promise<void> {
  await serviceCall(async () => {
    await apiClient.delete(`/workspaces/${workspaceId}`);
  });
}

// chatId routes to the owning backend (cloud chat skills live on the VPS).
async function getWorkspaceResources(
  workspaceId: string,
  chatId?: string,
): Promise<WorkspaceResources> {
  return serviceCall(async () => {
    const response = await resolveChatClient(chatId).get<WorkspaceResources>(
      `/workspaces/${workspaceId}/resources`,
    );
    return ensureResponse(response, 'Failed to fetch workspace resources');
  });
}

export const workspaceService = {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getWorkspaceResources,
};
