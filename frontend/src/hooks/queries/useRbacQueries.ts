import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rbacService } from '@/services/rbacService';
import type { RoleCreate, RoleUpdate, UserRoleAssign } from '@/types/rbac.types';

export function useRolesQuery() {
  return useQuery({
    queryKey: ['rbac', 'roles'],
    queryFn: () => rbacService.getRoles(),
  });
}

export function useRoleQuery(roleId: string) {
  return useQuery({
    queryKey: ['rbac', 'roles', roleId],
    queryFn: () => rbacService.getRole(roleId),
    enabled: !!roleId,
  });
}

export function usePermissionsQuery() {
  return useQuery({
    queryKey: ['rbac', 'permissions'],
    queryFn: () => rbacService.getPermissions(),
  });
}

export function useUserRolesQuery(userId: string) {
  return useQuery({
    queryKey: ['rbac', 'users', userId, 'roles'],
    queryFn: () => rbacService.getUserRoles(userId),
    enabled: !!userId,
  });
}

export function useUserPermissionsQuery(userId: string) {
  return useQuery({
    queryKey: ['rbac', 'users', userId, 'permissions'],
    queryFn: () => rbacService.getUserPermissions(userId),
    enabled: !!userId,
  });
}

export function useCreateRoleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: RoleCreate) => rbacService.createRole(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] });
    },
  });
}

export function useUpdateRoleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, data }: { roleId: string; data: RoleUpdate }) =>
      rbacService.updateRole(roleId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] });
    },
  });
}

export function useDeleteRoleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) => rbacService.deleteRole(roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] });
    },
  });
}

export function useInitializeRbacMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rbacService.initializeRbac(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac'] });
    },
  });
}

export function useAssignRoleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: UserRoleAssign }) =>
      rbacService.assignRole(userId, data),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'users', userId] });
    },
  });
}

export function useRemoveRoleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      rbacService.removeRole(userId, roleId),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'users', userId] });
    },
  });
}
