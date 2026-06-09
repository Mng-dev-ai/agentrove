import { useQuery } from '@tanstack/react-query';
import { cloudChatService } from '@/services/cloudChatService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import type { Workspace } from '@/types/workspace.types';

// Keyed by cloudUrl + connectedEmail so switching instance or account never
// serves the previous connection's cached list.
export const useCloudWorkspacesQuery = (enabled: boolean) => {
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);
  return useQuery<Workspace[]>({
    queryKey: queryKeys.cloudWorkspaces(cloudUrl, connectedEmail),
    queryFn: () => cloudChatService.listWorkspaces(),
    enabled: enabled && !!cloudUrl,
    staleTime: 30_000,
  });
};
