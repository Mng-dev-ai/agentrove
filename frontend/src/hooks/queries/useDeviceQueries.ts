import { useQuery } from '@tanstack/react-query';
import { deviceService } from '@/services/deviceService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { listLoadState, retryTransientOnce } from '@/hooks/queries/listLoad';
import type { PairedDevice } from '@/types/machine.types';

export const useDevices = () => {
  const query = useQuery<PairedDevice[]>({
    queryKey: queryKeys.devices,
    queryFn: () => deviceService.listDevices(),
    staleTime: 10_000,
    retry: retryTransientOnce,
  });
  return { devices: query.data ?? null, load: listLoadState([query]) };
};

export const useRevokeDeviceMutation = createMutation<void, Error, string>(
  (deviceId) => deviceService.revokeDevice(deviceId),
  (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
);
