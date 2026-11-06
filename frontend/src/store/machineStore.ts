import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  LOCAL_MACHINE_ID,
  type Machine,
  type MachineConnection,
  type MachineStatus,
} from '@/types/machine.types';
import { isDesktopApp } from '@/utils/platform';
import { useChatSettingsStore } from '@/store/chatSettingsStore';

interface MachineStoreState {
  machines: Machine[];
  defaultMachineId: string;
  connections: Record<string, MachineConnection>;
  addMachine: (machine: Machine) => void;
  updateMachine: (id: string, patch: Partial<Omit<Machine, 'id'>>) => void;
  removeMachine: (id: string) => void;
  setDefaultMachine: (id: string) => void;
  setConnection: (id: string, connection: MachineConnection) => void;
}

export const useMachineStore = create<MachineStoreState>()(
  persist(
    (set) => ({
      machines: [],
      defaultMachineId: LOCAL_MACHINE_ID,
      connections: {},
      addMachine: (machine) =>
        set((state) =>
          state.machines.some((existing) => existing.id === machine.id)
            ? {}
            : { machines: [...state.machines, machine] },
        ),
      updateMachine: (id, patch) =>
        set((state) => ({
          machines: state.machines.map((machine) =>
            machine.id === id ? { ...machine, ...patch } : machine,
          ),
        })),
      removeMachine: (id) =>
        set((state) => {
          const connections = { ...state.connections };
          delete connections[id];
          return {
            machines: state.machines.filter((machine) => machine.id !== id),
            connections,
            defaultMachineId:
              state.defaultMachineId === id ? LOCAL_MACHINE_ID : state.defaultMachineId,
          };
        }),
      setDefaultMachine: (id) => set({ defaultMachineId: id }),
      setConnection: (id, connection) =>
        set((state) =>
          state.machines.some((machine) => machine.id === id)
            ? { connections: { ...state.connections, [id]: connection } }
            : {},
        ),
    }),
    {
      name: 'machines-storage',
      partialize: (state) => ({
        machines: state.machines,
        defaultMachineId: state.defaultMachineId,
      }),
    },
  ),
);

export const LOCAL_MACHINE_NAME = isDesktopApp() ? 'This Mac' : 'This server';

export function getMachine(id: string): Machine | undefined {
  return useMachineStore.getState().machines.find((machine) => machine.id === id);
}

export function machineName(id: string): string {
  if (id === LOCAL_MACHINE_ID) return LOCAL_MACHINE_NAME;
  return getMachine(id)?.name ?? 'Removed machine';
}

export function machineStatus(id: string): MachineStatus {
  if (id === LOCAL_MACHINE_ID) return 'online';
  return useMachineStore.getState().connections[id]?.status ?? 'checking';
}

export function useMachineStatus(id: string): MachineStatus {
  return useMachineStore(() => machineStatus(id));
}

export function useMachineName(id: string): string {
  return useMachineStore(() => machineName(id));
}

export function useOnlineRemoteMachineIds(): string[] {
  const key = useMachineStore((state) =>
    state.machines
      .filter((machine) => state.connections[machine.id]?.status === 'online')
      .map((machine) => machine.id)
      .join('\n'),
  );
  return useMemo(() => (key ? key.split('\n') : []), [key]);
}

export function useRemoteMachineIds(): string[] {
  const key = useMachineStore((state) => state.machines.map((machine) => machine.id).join('\n'));
  return useMemo(() => (key ? key.split('\n') : []), [key]);
}

export function useTargetMachineId(): string {
  const target = useChatSettingsStore((state) => state.targetMachineId);
  return useMachineStore((state) => {
    const id = target ?? state.defaultMachineId;
    return id === LOCAL_MACHINE_ID || state.machines.some((machine) => machine.id === id)
      ? id
      : LOCAL_MACHINE_ID;
  });
}
