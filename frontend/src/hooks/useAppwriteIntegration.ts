import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  integrationsService,
  type AppwriteStatus,
  type AppwriteConfig,
} from '@/services/integrationsService';

const APPWRITE_STATUS_KEY = ['integrations', 'appwrite', 'status'] as const;

export function useAppwriteIntegration() {
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<AppwriteStatus>({
    queryKey: APPWRITE_STATUS_KEY,
    queryFn: integrationsService.getAppwriteStatus,
  });

  const configureMutation = useMutation({
    mutationFn: (config: AppwriteConfig) => integrationsService.configureAppwrite(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: APPWRITE_STATUS_KEY });
      toast.success('Appwrite connected successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to connect Appwrite');
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: integrationsService.disconnectAppwrite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: APPWRITE_STATUS_KEY });
      toast.success('Appwrite disconnected');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to disconnect Appwrite');
    },
  });

  const validateMutation = useMutation({
    mutationFn: integrationsService.validateAppwriteConnection,
    onSuccess: () => {
      toast.success('Connection validated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Connection validation failed');
    },
  });

  return {
    status: status ?? {
      connected: false,
      endpoint: null,
      project_id: null,
      project_name: null,
      connected_at: null,
    },
    isLoading,
    configure: configureMutation.mutate,
    isConfiguring: configureMutation.isPending,
    disconnect: disconnectMutation.mutate,
    isDisconnecting: disconnectMutation.isPending,
    validate: validateMutation.mutate,
    isValidating: validateMutation.isPending,
  };
}
