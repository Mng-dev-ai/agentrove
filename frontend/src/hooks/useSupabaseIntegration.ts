import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  integrationsService,
  type SupabaseStatus,
  type SupabaseConfig,
} from '@/services/integrationsService';

const SUPABASE_STATUS_KEY = ['integrations', 'supabase', 'status'] as const;

export function useSupabaseIntegration() {
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useQuery<SupabaseStatus>({
    queryKey: SUPABASE_STATUS_KEY,
    queryFn: integrationsService.getSupabaseStatus,
  });

  const configureMutation = useMutation({
    mutationFn: (config: SupabaseConfig) => integrationsService.configureSupabase(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUPABASE_STATUS_KEY });
      toast.success('Supabase connected successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to connect Supabase');
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: integrationsService.disconnectSupabase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUPABASE_STATUS_KEY });
      toast.success('Supabase disconnected');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to disconnect Supabase');
    },
  });

  const validateMutation = useMutation({
    mutationFn: integrationsService.validateSupabaseConnection,
    onSuccess: () => {
      toast.success('Connection validated successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Connection validation failed');
    },
  });

  return {
    status: status ?? { connected: false, url: null, project_name: null, connected_at: null },
    isLoading,
    configure: configureMutation.mutate,
    isConfiguring: configureMutation.isPending,
    disconnect: disconnectMutation.mutate,
    isDisconnecting: disconnectMutation.isPending,
    validate: validateMutation.mutate,
    isValidating: validateMutation.isPending,
  };
}
