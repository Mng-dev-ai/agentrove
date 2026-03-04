import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  systemService,
  type SystemStatus,
  type MasterPasswordRequest,
  type RemoteDbConfigRequest,
  type InstanceConfigRequest,
} from '@/services/systemService';

const SYSTEM_STATUS_KEY = ['system', 'status'] as const;

export function useSystemStatus() {
  const { data: status, isLoading, error } = useQuery<SystemStatus>({
    queryKey: SYSTEM_STATUS_KEY,
    queryFn: systemService.getStatus.bind(systemService),
  });

  return {
    status,
    isLoading,
    error,
  };
}

export function useSetMasterPassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: MasterPasswordRequest) => systemService.setMasterPassword(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_STATUS_KEY });
      toast.success('Master password set successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to set master password');
    },
  });
}

export function useVerifyMasterPassword() {
  return useMutation({
    mutationFn: (password: string) => systemService.verifyMasterPassword(password),
  });
}

export function useConfigureRemoteDb() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: RemoteDbConfigRequest) => systemService.configureRemoteDb(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_STATUS_KEY });
      toast.success('Remote database configured successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to configure remote database');
    },
  });
}

export function useDisableRemoteDb() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => systemService.disableRemoteDb(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_STATUS_KEY });
      toast.success('Remote database disabled');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to disable remote database');
    },
  });
}

export function useConfigureInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: InstanceConfigRequest) => systemService.configureInstance(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_STATUS_KEY });
      toast.success('Instance configuration updated');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update instance configuration');
    },
  });
}
