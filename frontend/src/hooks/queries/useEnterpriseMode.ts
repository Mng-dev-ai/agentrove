import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';

export function useEnterpriseMode() {
  return useQuery({
    queryKey: ['enterprise-mode'],
    queryFn: () => settingsService.getEnterpriseMode(),
  });
}

export function useSetEnterpriseMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => settingsService.setEnterpriseMode(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enterprise-mode'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
