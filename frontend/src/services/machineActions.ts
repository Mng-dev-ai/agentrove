import { queryClient } from '@/lib/queryClient';
import { disposeMachineClient } from '@/lib/api';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { getMachine, useMachineStore } from '@/store/machineStore';
import {
  checkMachine,
  dropMachineAccess,
  fetchInstanceId,
  probeOrigin,
  storeMachineAccess,
} from '@/services/machineSession';
import { MachineVaultError, machineVault } from '@/services/machineVault';
import { forgetMachineOrigins } from '@/store/machineOrigin';
import { parsePairingLink } from '@/utils/machineUrl';
import { isDesktopApp } from '@/utils/platform';
import type { Machine } from '@/types/machine.types';

export type PairFailure =
  | { kind: 'invalid_link' }
  | { kind: 'not_https' }
  | { kind: 'origin_blocked'; origin: string }
  | { kind: 'unreachable'; origin: string }
  | { kind: 'tls'; origin: string }
  | { kind: 'different_server'; origin: string }
  | { kind: 'duplicate'; name: string }
  | { kind: 'unpaired_duplicate'; machineId: string; name: string }
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
  | { mode: 'add'; name: string; link: string }
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

  const probe = await probeOrigin(origin);
  if (probe.kind === 'origin_blocked') throw new PairError({ kind: 'origin_blocked', origin });
  if (probe.kind === 'unreachable') {
    throw new PairError({ kind: probe.tls ? 'tls' : 'unreachable', origin });
  }

  const instanceId = await fetchInstanceId(origin);
  if (!instanceId) throw new PairError({ kind: 'unreachable', origin });
  if (
    existing &&
    (existing.pairing ? existing.pairing.instanceId !== instanceId : existing.url !== origin)
  ) {
    throw new PairError({ kind: 'different_server', origin });
  }
  const duplicate = useMachineStore
    .getState()
    .machines.find(
      (machine) =>
        machine.id !== existing?.id &&
        (machine.pairing ? machine.pairing.instanceId === instanceId : machine.url === origin),
    );
  if (duplicate) {
    throw new PairError(
      duplicate.pairing
        ? { kind: 'duplicate', name: duplicate.name }
        : { kind: 'unpaired_duplicate', machineId: duplicate.id, name: duplicate.name },
    );
  }

  const machineId = existing?.id ?? crypto.randomUUID();
  let paired;
  try {
    paired = await machineVault.pair(machineId, origin, secret, deviceName());
  } catch (error) {
    throw new PairError(vaultFailure(error, origin));
  }
  if (paired.instance_id !== instanceId) {
    await machineVault.unpair(machineId, paired.device_id).catch(() => undefined);
    throw new PairError({ kind: 'different_server', origin });
  }

  storeMachineAccess(machineId, paired);
  const pairedFields = {
    url: origin,
    pairing: {
      instanceId: paired.instance_id,
      deviceId: paired.device_id,
      pairedAt: new Date().toISOString(),
    },
  };
  const store = useMachineStore.getState();
  if (existing) {
    store.updateMachine(machineId, pairedFields);
  } else if (request.mode === 'add') {
    store.addMachine({ id: machineId, name: request.name.trim(), ...pairedFields });
  }
  void queryClient.invalidateQueries({ queryKey: queryKeys.machine.all(machineId) });
  await checkMachine(machineId);
  return getMachine(machineId)!;
}

export async function removeMachine(machineId: string): Promise<{ revoked: boolean }> {
  const machine = getMachine(machineId);
  if (!machine) return { revoked: true };
  const online = useMachineStore.getState().connections[machineId]?.status === 'online';
  await queryClient.cancelQueries({ queryKey: queryKeys.machine.all(machineId) });

  let revoked = !machine.pairing;
  try {
    if (machine.pairing && online) {
      revoked = (await machineVault.unpair(machineId, machine.pairing.deviceId)).revoked;
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
