import { queryClient } from '@/lib/queryClient';
import { disposeMachineClient } from '@/lib/api';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { getMachine, useMachineStore } from '@/store/machineStore';
import {
  checkMachine,
  dropMachineAccess,
  fetchInstanceId,
  probeRoute,
  storeMachineAccess,
} from '@/services/machineSession';
import { MachineVaultError, machineVault } from '@/services/machineVault';
import { forgetMachineOrigins } from '@/utils/machineOrigin';
import { normalizeHttpsOrigin, parsePairingLink, routeKindForOrigin } from '@/utils/machineUrl';
import { isDesktopApp } from '@/utils/platform';
import type { Machine, MachineKind, MachineRoute } from '@/types/machine.types';

export type PairFailure =
  | { kind: 'invalid_link' }
  | { kind: 'not_https' }
  | { kind: 'origin_blocked'; origin: string }
  | { kind: 'unreachable'; origin: string }
  | { kind: 'tls'; origin: string }
  | { kind: 'different_server'; origin: string }
  | { kind: 'duplicate'; name: string }
  | { kind: 'keychain'; message: string }
  | { kind: 'other'; message: string };

export class PairError extends Error {
  failure: PairFailure;

  constructor(failure: PairFailure) {
    super(failure.kind);
    this.name = 'PairError';
    this.failure = failure;
  }
}

export type PairRequest =
  | { mode: 'add'; name: string; kind: MachineKind; link: string }
  | { mode: 'repair'; machineId: string; link: string };

function deviceName(): string {
  return isDesktopApp() ? 'AgentRove Desktop' : `Browser on ${window.location.host}`;
}

function vaultFailure(error: unknown, origin: string): PairFailure {
  if (!(error instanceof MachineVaultError)) {
    return { kind: 'other', message: error instanceof Error ? error.message : String(error) };
  }
  switch (error.code) {
    case 'invalid_link':
      return { kind: 'invalid_link' };
    case 'tls':
      return { kind: 'tls', origin };
    case 'unreachable':
      return { kind: 'unreachable', origin };
    case 'keychain_unavailable':
      return { kind: 'keychain', message: error.message };
    default:
      return { kind: 'other', message: error.message };
  }
}

function withRoute(routes: MachineRoute[], origin: string): MachineRoute[] {
  return routes.some((route) => route.url === origin)
    ? routes
    : [...routes, { kind: routeKindForOrigin(origin), url: origin }];
}

export async function pairMachine(request: PairRequest): Promise<Machine> {
  const link = parsePairingLink(request.link);
  if (!link.ok) {
    throw new PairError({ kind: link.reason === 'not_https' ? 'not_https' : 'invalid_link' });
  }
  const { origin, secret } = link;
  const existing = request.mode === 'repair' ? getMachine(request.machineId) : undefined;
  if (request.mode === 'repair' && !existing) {
    throw new PairError({ kind: 'other', message: 'This machine was removed' });
  }

  const probe = await probeRoute(origin);
  if (probe.kind === 'origin_blocked') throw new PairError({ kind: 'origin_blocked', origin });
  if (probe.kind === 'unreachable') {
    throw new PairError({ kind: probe.tls ? 'tls' : 'unreachable', origin });
  }

  const instanceId = await fetchInstanceId(origin);
  if (!instanceId) throw new PairError({ kind: 'unreachable', origin });
  if (existing?.instanceId && existing.instanceId !== instanceId) {
    throw new PairError({ kind: 'different_server', origin });
  }
  const duplicate = useMachineStore
    .getState()
    .machines.find((machine) => machine.instanceId === instanceId && machine.id !== existing?.id);
  if (duplicate) throw new PairError({ kind: 'duplicate', name: duplicate.name });

  const machineId = existing?.id ?? crypto.randomUUID();
  let paired;
  try {
    paired = await machineVault.pair(machineId, origin, secret, deviceName());
  } catch (error) {
    throw new PairError(vaultFailure(error, origin));
  }
  if (paired.instance_id !== instanceId) {
    await machineVault.unpair(machineId, origin, paired.device_id).catch(() => undefined);
    throw new PairError({ kind: 'different_server', origin });
  }

  storeMachineAccess(machineId, paired);
  const pairedFields = {
    instanceId: paired.instance_id,
    deviceId: paired.device_id,
    pairedAt: new Date().toISOString(),
  };
  const store = useMachineStore.getState();
  if (existing) {
    store.updateMachine(machineId, { ...pairedFields, routes: withRoute(existing.routes, origin) });
  } else if (request.mode === 'add') {
    store.addMachine({
      id: machineId,
      name: request.name.trim(),
      kind: request.kind,
      routes: [{ kind: routeKindForOrigin(origin), url: origin }],
      ...pairedFields,
    });
  }
  void queryClient.invalidateQueries({ queryKey: queryKeys.machine.all(machineId) });
  await checkMachine(machineId);
  return getMachine(machineId)!;
}

export async function removeMachine(machineId: string): Promise<{ revoked: boolean }> {
  const machine = getMachine(machineId);
  if (!machine) return { revoked: true };
  const connection = useMachineStore.getState().connections[machineId];
  const routeUrl =
    connection?.status === 'online' ? connection.routeUrl : (machine.routes[0]?.url ?? '');

  let revoked = !machine.deviceId;
  try {
    if (machine.deviceId && routeUrl) {
      revoked = (await machineVault.unpair(machineId, routeUrl, machine.deviceId)).revoked;
    } else {
      await machineVault.forget(machineId);
    }
  } catch {
    revoked = false;
  }

  dropMachineAccess(machineId);
  disposeMachineClient(machineId);
  forgetMachineOrigins(machineId);
  useMachineStore.getState().removeMachine(machineId);
  queryClient.removeQueries({ queryKey: queryKeys.machine.all(machineId) });
  return { revoked };
}

export function updateMachineRoutes(machineId: string, urls: string[]): void {
  const routes = urls.map((url) => {
    const origin = normalizeHttpsOrigin(url);
    if (!origin) throw new Error(`${url} is not an https URL`);
    return { kind: routeKindForOrigin(origin), url: origin };
  });
  if (routes.length === 0) throw new Error('Add at least one route');
  const unique = routes.filter(
    (route, index) => routes.findIndex((other) => other.url === route.url) === index,
  );
  useMachineStore.getState().updateMachine(machineId, { routes: unique });
  void checkMachine(machineId);
}
