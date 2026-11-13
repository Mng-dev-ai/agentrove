import { useState } from 'react';
import type {
  ListFilterCategory,
  ListFilterOption,
} from '@/components/ui/ListManagementTab/ListFilterMenu';

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

export function useMachineFilter(machineOptions: ListFilterOption[], emptyText: string) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const machineId = machineOptions.some((machine) => machine.id === selectedId) ? selectedId : null;
  return {
    machineId,
    filter: {
      categories: machineFilterCategories(machineOptions, machineId, setSelectedId),
      onClear: () => setSelectedId(null),
      emptyText,
    },
  };
}
