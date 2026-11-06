import { useSyncExternalStore } from 'react';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { getMachine } from '@/store/machineStore';

const CHATS_KEY = 'machine-chat-origins';
const SANDBOXES_KEY = 'machine-sandbox-origins';
const REMOVED_MACHINES_KEY = 'machine-removed-instances';

function load(key: string): Map<string, string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return new Map();
  }
}

function persist(key: string, origins: Map<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(origins)));
  } catch {
    return;
  }
}

const chatOrigins = load(CHATS_KEY);
const sandboxOrigins = load(SANDBOXES_KEY);
const removedMachineInstances = load(REMOVED_MACHINES_KEY);
let chatOriginsSnapshot: ReadonlyMap<string, string> = new Map(chatOrigins);
const listeners = new Set<() => void>();

function notify(): void {
  chatOriginsSnapshot = new Map(chatOrigins);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function assign(
  origins: Map<string, string>,
  key: string,
  machineId: string,
  ids: Iterable<string>,
): boolean {
  if (machineId !== LOCAL_MACHINE_ID && !getMachine(machineId)) return false;
  let changed = false;
  for (const id of ids) {
    if (!id || origins.has(id)) continue;
    origins.set(id, machineId);
    changed = true;
  }
  if (changed) persist(key, origins);
  return changed;
}

export function assignChatsToMachine(machineId: string, chatIds: Iterable<string>): void {
  if (assign(chatOrigins, CHATS_KEY, machineId, chatIds)) notify();
}

export function assignSandboxesToMachine(machineId: string, sandboxIds: Iterable<string>): void {
  assign(sandboxOrigins, SANDBOXES_KEY, machineId, sandboxIds);
}

export function assignChatRecordsToMachine(
  machineId: string,
  chats: { id: string; sandbox_id: string }[],
): void {
  assignChatsToMachine(
    machineId,
    chats.map((chat) => chat.id),
  );
  assignSandboxesToMachine(
    machineId,
    chats.map((chat) => chat.sandbox_id),
  );
}

export function chatMachineId(chatId: string | undefined): string {
  return (chatId && chatOrigins.get(chatId)) || LOCAL_MACHINE_ID;
}

export function sandboxMachineId(sandboxId: string | undefined): string {
  return (sandboxId && sandboxOrigins.get(sandboxId)) || LOCAL_MACHINE_ID;
}

export function useChatMachineId(chatId: string | undefined): string {
  return useSyncExternalStore(subscribe, () => chatMachineId(chatId));
}

export function useChatOrigins(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribe, () => chatOriginsSnapshot);
}

export function recordRemovedMachine(machineId: string, instanceId: string): void {
  removedMachineInstances.set(machineId, instanceId);
  persist(REMOVED_MACHINES_KEY, removedMachineInstances);
}

export function claimRemovedMachineOrigins(instanceId: string, machineId: string): void {
  const removedIds = new Set(
    [...removedMachineInstances]
      .filter(([, removedInstanceId]) => removedInstanceId === instanceId)
      .map(([removedId]) => removedId),
  );
  if (removedIds.size === 0) return;
  for (const [origins, key] of [
    [chatOrigins, CHATS_KEY],
    [sandboxOrigins, SANDBOXES_KEY],
  ] as const) {
    for (const [id, owner] of origins) {
      if (removedIds.has(owner)) origins.set(id, machineId);
    }
    persist(key, origins);
  }
  for (const removedId of removedIds) removedMachineInstances.delete(removedId);
  persist(REMOVED_MACHINES_KEY, removedMachineInstances);
  notify();
}
