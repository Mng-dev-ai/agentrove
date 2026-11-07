import { useSyncExternalStore } from 'react';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { getMachine } from '@/store/machineStore';

const CHATS_KEY = 'machine-chat-origins';
const SANDBOXES_KEY = 'machine-sandbox-origins';
const REMOVED_MACHINES_KEY = 'machine-removed-identities';

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

type OriginKey = typeof CHATS_KEY | typeof SANDBOXES_KEY | typeof REMOVED_MACHINES_KEY;

const maps: Record<OriginKey, Map<string, string>> = {
  [CHATS_KEY]: load(CHATS_KEY),
  [SANDBOXES_KEY]: load(SANDBOXES_KEY),
  [REMOVED_MACHINES_KEY]: load(REMOVED_MACHINES_KEY),
};
let chatOriginsSnapshot: ReadonlyMap<string, string> = new Map(maps[CHATS_KEY]);
const listeners = new Set<() => void>();

function notify(): void {
  chatOriginsSnapshot = new Map(maps[CHATS_KEY]);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isLiveMachine(machineId: string): boolean {
  return machineId === LOCAL_MACHINE_ID || !!getMachine(machineId);
}

function withUnsaved(key: OriginKey): Map<string, string> {
  const map = load(key);
  for (const [id, value] of maps[key]) {
    const stored = map.get(id);
    if (
      stored === undefined ||
      (stored !== value && key !== REMOVED_MACHINES_KEY && isLiveMachine(value))
    ) {
      map.set(id, value);
    }
  }
  return map;
}

function update(key: OriginKey, change: (map: Map<string, string>) => boolean): boolean {
  const map = withUnsaved(key);
  const changed = change(map);
  if (changed) persist(key, map);
  maps[key] = map;
  return changed;
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && !(event.key in maps)) return;
    for (const key of Object.keys(maps) as OriginKey[]) maps[key] = withUnsaved(key);
    notify();
  });
}

function assign(key: OriginKey, machineId: string, ids: Iterable<string>): boolean {
  if (machineId !== LOCAL_MACHINE_ID && !getMachine(machineId)) return false;
  return update(key, (origins) => {
    let changed = false;
    for (const id of ids) {
      if (!id || origins.has(id)) continue;
      origins.set(id, machineId);
      changed = true;
    }
    return changed;
  });
}

export function assignChatsToMachine(machineId: string, chatIds: Iterable<string>): void {
  if (assign(CHATS_KEY, machineId, chatIds)) notify();
}

export function assignSandboxesToMachine(machineId: string, sandboxIds: Iterable<string>): void {
  assign(SANDBOXES_KEY, machineId, sandboxIds);
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
  return (chatId && maps[CHATS_KEY].get(chatId)) || LOCAL_MACHINE_ID;
}

export function sandboxMachineId(sandboxId: string | undefined): string {
  return (sandboxId && maps[SANDBOXES_KEY].get(sandboxId)) || LOCAL_MACHINE_ID;
}

export function useChatMachineId(chatId: string | undefined): string {
  return useSyncExternalStore(subscribe, () => chatMachineId(chatId));
}

export function useChatOrigins(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribe, () => chatOriginsSnapshot);
}

export type MachineIdentity = { instanceId: string } | { url: string };

function identityKey(identity: MachineIdentity): string {
  return 'instanceId' in identity ? `instance:${identity.instanceId}` : `url:${identity.url}`;
}

export function recordRemovedMachine(machineId: string, identity: MachineIdentity): void {
  update(REMOVED_MACHINES_KEY, (removed) => {
    removed.set(machineId, identityKey(identity));
    return true;
  });
}

export function claimRemovedMachineOrigins(machineId: string, identities: MachineIdentity[]): void {
  const keys = new Set(identities.map(identityKey));
  const removedIds = new Set(
    [...withUnsaved(REMOVED_MACHINES_KEY)]
      .filter(([, key]) => keys.has(key))
      .map(([removedId]) => removedId),
  );
  if (removedIds.size === 0) return;
  for (const key of [CHATS_KEY, SANDBOXES_KEY] as const) {
    update(key, (origins) => {
      let changed = false;
      for (const [id, owner] of origins) {
        if (!removedIds.has(owner)) continue;
        origins.set(id, machineId);
        changed = true;
      }
      return changed;
    });
  }
  update(REMOVED_MACHINES_KEY, (removed) => {
    for (const removedId of removedIds) removed.delete(removedId);
    return true;
  });
  notify();
}
