import { apiClient, getMachineClient } from '@/lib/api';
import { ensureResponse, serviceCall, buildQueryString } from '@/services/base/BaseService';
import type {
  Workspace,
  WorkspaceResources,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
} from '@/types/workspace.types';
import { assignSandboxesToMachine } from '@/store/machineOrigin';
import type { PaginationParams, PaginatedResponse } from '@/types/api.types';

async function listWorkspaces(
  machineId: string,
  pagination?: PaginationParams,
): Promise<PaginatedResponse<Workspace>> {
  return serviceCall(async () => {
    const queryString = buildQueryString(pagination ? { ...pagination } : undefined);
    const response = await getMachineClient(machineId).get<PaginatedResponse<Workspace>>(
      `/workspaces${queryString}`,
    );
    const data = ensureResponse(response, 'Failed to fetch workspaces');
    assignSandboxesToMachine(
      machineId,
      data.items.map((workspace) => workspace.sandbox_id).filter((id): id is string => !!id),
    );
    return data;
  });
}

async function createWorkspace(data: CreateWorkspaceRequest): Promise<Workspace> {
  return serviceCall(async () => {
    const response = await apiClient.post<Workspace>('/workspaces', data);
    return ensureResponse(response, 'Failed to create workspace');
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
    return ensureResponse(response, 'Failed to update workspace');
  });
}

async function deleteWorkspace(machineId: string, workspaceId: string): Promise<void> {
  await serviceCall(async () => {
    await getMachineClient(machineId).delete(`/workspaces/${workspaceId}`);
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

export const workspaceService = {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getWorkspaceResources,
};
