import { useQuery } from '@tanstack/react-query';
import { deviceService } from '@/services/deviceService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import type { PairedDevice } from '@/types/machine.types';

export const useDevicesQuery = () =>
  useQuery<PairedDevice[]>({
    queryKey: queryKeys.devices,
    queryFn: () => deviceService.listDevices(),
    staleTime: 10_000,
  });

export const useRevokeDeviceMutation = createMutation<void, Error, string>(
  (deviceId) => deviceService.revokeDevice(deviceId),
  (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
);
