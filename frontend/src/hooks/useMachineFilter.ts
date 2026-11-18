import { useState } from 'react';
import type {
  ListFilterCategory,
  ListFilterOption,
} from '@/components/ui/ListManagementTab/ListFilterMenu';
import { useTargetMachineId } from '@/store/machineStore';

export function machineFilterCategories(
  machineOptions: ListFilterOption[],
  value: string | null,
  onChange: (machineId: string | null) => void,
): ListFilterCategory[] {
  return machineOptions.length > 1
    ? [
        {
          key: 'machine',
          label: 'Machine',
          allLabel: 'All machines',
          value,
          groups: [{ heading: null, options: machineOptions }],
          onChange,
        },
      ]
    : [];
}

export function useDefaultMachineId(machineOptions: ListFilterOption[]): string | null {
  const targetId = useTargetMachineId();
  return machineOptions.length > 1 && machineOptions.some((machine) => machine.id === targetId)
    ? targetId
    : null;
}

export function useMachineFilter(machineOptions: ListFilterOption[], emptyText: string) {
  const defaultId = useDefaultMachineId(machineOptions);
  const [selectedId, setSelectedId] = useState<string | null>();
  const requestedId = selectedId === undefined ? defaultId : selectedId;
  const machineId = machineOptions.some((machine) => machine.id === requestedId)
    ? requestedId
    : null;
  return {
    machineId,
    filter: {
      categories: machineFilterCategories(machineOptions, machineId, setSelectedId),
      onClear: () => setSelectedId(null),
      emptyText,
    },
  };
}
