import { useQuery, type QueryClient } from '@tanstack/react-query';
import { automationService } from '@/services/automationService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import type {
  Automation,
  AutomationCreateRequest,
  AutomationUpdateRequest,
} from '@/types/automation.types';

// Each automation is owned by one backend, so mutations carry onCloud and
// invalidate only that backend's list.
function invalidateAutomations(queryClient: QueryClient, onCloud: boolean) {
  if (onCloud) {
    const { cloudUrl, connectedEmail } = useCloudSettingsStore.getState();
    void queryClient.invalidateQueries({
      queryKey: queryKeys.cloudAutomations(cloudUrl, connectedEmail),
    });
  } else {
    void queryClient.invalidateQueries({ queryKey: queryKeys.automations });
  }
}

export const useAutomationsQuery = () =>
  useQuery<Automation[]>({
    queryKey: queryKeys.automations,
    queryFn: () => automationService.listAutomations(false),
    staleTime: 30_000,
  });

// Keyed by cloudUrl + connectedEmail so switching instance or account never
// serves the previous connection's cached list.
export const useCloudAutomationsQuery = (enabled: boolean) => {
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);
  return useQuery<Automation[]>({
    queryKey: queryKeys.cloudAutomations(cloudUrl, connectedEmail),
    queryFn: () => automationService.listAutomations(true),
    enabled: enabled && !!cloudUrl,
    staleTime: 30_000,
  });
};

export const useCreateAutomationMutation = createMutation<
  Automation,
  Error,
  { data: AutomationCreateRequest; onCloud: boolean }
>(
  ({ data, onCloud }) => automationService.createAutomation(data, onCloud),
  (queryClient, _data, variables) => invalidateAutomations(queryClient, variables.onCloud),
);

export const useUpdateAutomationMutation = createMutation<
  Automation,
  Error,
  { automationId: string; data: AutomationUpdateRequest; onCloud: boolean }
>(
  ({ automationId, data, onCloud }) =>
    automationService.updateAutomation(automationId, data, onCloud),
  (queryClient, _data, variables) => invalidateAutomations(queryClient, variables.onCloud),
);

export const useDeleteAutomationMutation = createMutation<
  void,
  Error,
  { automationId: string; onCloud: boolean }
>(
  ({ automationId, onCloud }) => automationService.deleteAutomation(automationId, onCloud),
  (queryClient, _data, variables) => invalidateAutomations(queryClient, variables.onCloud),
);

export const useRunAutomationMutation = createMutation<
  { chat_id: string },
  Error,
  { automationId: string; onCloud: boolean }
>(
  ({ automationId, onCloud }) => automationService.runAutomation(automationId, onCloud),
  (queryClient, _data, variables) => {
    // Refresh last_run_at on the list, plus the sidebar chats of the backend
    // the run landed on.
    invalidateAutomations(queryClient, variables.onCloud);
    if (variables.onCloud) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloudChatsAll });
    } else {
      void queryClient.invalidateQueries({ queryKey: [queryKeys.chats] });
    }
  },
);
