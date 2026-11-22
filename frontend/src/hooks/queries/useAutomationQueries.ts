import { useCallback } from 'react';
import { useQueries, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useOnlineRemoteMachineIds } from '@/store/machineStore';
import { automationService } from '@/services/automationService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { listLoadState, retryTransientOnce, type ListLoadState } from '@/hooks/queries/listLoad';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type {
  Automation,
  AutomationCreateRequest,
  AutomationRunResponse,
  AutomationUpdateRequest,
} from '@/types/automation.types';

const automationsKey = (machineId: string) =>
  machineId === LOCAL_MACHINE_ID ? queryKeys.automations : queryKeys.machine.automations(machineId);

function invalidateAutomations(queryClient: QueryClient, machineId: string) {
  void queryClient.invalidateQueries({ queryKey: automationsKey(machineId) });
}

export interface MachineAutomation {
  automation: Automation;
  machineId: string;
}

export const useAutomationsAcrossMachines = (
  filterMachineId: string | null,
): {
  items: MachineAutomation[] | null;
  load: ListLoadState;
} => {
  const remoteIds = useOnlineRemoteMachineIds();
  const combine = useCallback(
    (results: UseQueryResult<Automation[]>[]) => {
      const shown = [LOCAL_MACHINE_ID, ...remoteIds]
        .map((machineId, index) => ({ machineId, result: results[index] }))
        .filter(({ machineId }) => !filterMachineId || machineId === filterMachineId);
      const load = listLoadState(shown.map(({ result }) => result));
      if (shown.some(({ result }) => result.isLoading)) return { items: null, load };
      return {
        items: shown.flatMap(({ machineId, result }) =>
          (result.data ?? []).map((automation) => ({ automation, machineId })),
        ),
        load,
      };
    },
    [remoteIds, filterMachineId],
  );
  return useQueries({
    queries: [LOCAL_MACHINE_ID, ...remoteIds].map((machineId) => ({
      queryKey: automationsKey(machineId),
      queryFn: () => automationService.listAutomations(machineId),
      staleTime: 30_000,
      retry: retryTransientOnce,
    })),
    combine,
  });
};

export const useCreateAutomationMutation = createMutation<
  Automation,
  Error,
  { data: AutomationCreateRequest; machineId: string }
>(
  ({ data, machineId }) => automationService.createAutomation(data, machineId),
  (queryClient, _data, variables) => invalidateAutomations(queryClient, variables.machineId),
);

export const useUpdateAutomationMutation = createMutation<
  Automation,
  Error,
  { automationId: string; data: AutomationUpdateRequest; machineId: string }
>(
  ({ automationId, data, machineId }) =>
    automationService.updateAutomation(automationId, data, machineId),
  (queryClient, _data, variables) => invalidateAutomations(queryClient, variables.machineId),
);

export const useDeleteAutomationMutation = createMutation<
  void,
  Error,
  { automationId: string; machineId: string }
>(
  ({ automationId, machineId }) => automationService.deleteAutomation(automationId, machineId),
  (queryClient, _data, variables) => invalidateAutomations(queryClient, variables.machineId),
);

export const useRunAutomationMutation = createMutation<
  AutomationRunResponse,
  Error,
  { automationId: string; machineId: string }
>(
  ({ automationId, machineId }) => automationService.runAutomation(automationId, machineId),
  (queryClient, data, variables) => {
    invalidateAutomations(queryClient, variables.machineId);
    void queryClient.invalidateQueries({
      queryKey: data.channel_id
        ? queryKeys.channels(variables.machineId)
        : variables.machineId === LOCAL_MACHINE_ID
          ? [queryKeys.chats]
          : queryKeys.machine.chats(variables.machineId),
    });
  },
);
