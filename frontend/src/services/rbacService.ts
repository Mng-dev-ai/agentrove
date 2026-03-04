import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';
import type {
  Role,
  RoleWithPermissions,
  RoleCreate,
  RoleUpdate,
  Permission,
  UserRoleAssign,
} from '@/types/rbac.types';

async function getRoles(): Promise<RoleWithPermissions[]> {
  return withAuth(async () => {
    const response = await apiClient.get<RoleWithPermissions[]>('/rbac/roles');
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getRole(roleId: string): Promise<RoleWithPermissions> {
  return withAuth(async () => {
    const response = await apiClient.get<RoleWithPermissions>(`/rbac/roles/${roleId}`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function createRole(data: RoleCreate): Promise<RoleWithPermissions> {
  return withAuth(async () => {
    const response = await apiClient.post<RoleWithPermissions>('/rbac/roles', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function updateRole(roleId: string, data: RoleUpdate): Promise<RoleWithPermissions> {
  return withAuth(async () => {
    const response = await apiClient.patch<RoleWithPermissions>(`/rbac/roles/${roleId}`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteRole(roleId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/rbac/roles/${roleId}`);
  });
}

async function getPermissions(): Promise<Permission[]> {
  return withAuth(async () => {
    const response = await apiClient.get<Permission[]>('/rbac/permissions');
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function initializeRbac(): Promise<void> {
  return withAuth(async () => {
    await apiClient.post('/rbac/initialize');
  });
}

async function assignRole(userId: string, data: UserRoleAssign): Promise<void> {
  return withAuth(async () => {
    await apiClient.post(`/rbac/users/${userId}/roles`, data);
  });
}

async function removeRole(userId: string, roleId: string): Promise<void> {
  return withAuth(async () => {
    await apiClient.delete(`/rbac/users/${userId}/roles/${roleId}`);
  });
}

async function getUserRoles(userId: string): Promise<Role[]> {
  return withAuth(async () => {
    const response = await apiClient.get<Role[]>(`/rbac/users/${userId}/roles`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getUserPermissions(userId: string): Promise<string[]> {
  return withAuth(async () => {
    const response = await apiClient.get<string[]>(`/rbac/users/${userId}/permissions`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

export const rbacService = {
  getRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  getPermissions,
  initializeRbac,
  assignRole,
  removeRole,
  getUserRoles,
  getUserPermissions,
};
