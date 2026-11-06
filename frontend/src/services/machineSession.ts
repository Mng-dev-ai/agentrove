import { getMachine, useMachineStore } from '@/store/machineStore';
import { MachineVaultError, machineVault, type MachineAccessGrant } from '@/services/machineVault';
import { logger } from '@/utils/logger';
import type { Machine, MachineConnection } from '@/types/machine.types';

const HEALTH_TIMEOUT_MS = 5_000;
const ACCESS_REFRESH_BUFFER_MS = 60_000;

export class MachineUnavailableError extends Error {
  constructor(name: string) {
    super(`${name} is not connected`);
    this.name = 'MachineUnavailableError';
  }
}

const accessGrants = new Map<string, MachineAccessGrant>();
const inflightChecks = new Map<string, Promise<void>>();

export function getMachineAccessToken(machineId: string): string | null {
  return accessGrants.get(machineId)?.access_token ?? null;
}

export function storeMachineAccess(machineId: string, grant: MachineAccessGrant): void {
  accessGrants.set(machineId, grant);
}

export function dropMachineAccess(machineId: string): void {
  accessGrants.delete(machineId);
}

function hasFreshAccess(machineId: string): boolean {
  const grant = accessGrants.get(machineId);
  return !!grant && grant.expires_at * 1000 - Date.now() > ACCESS_REFRESH_BUFFER_MS;
}

export function onlineRouteUrl(machineId: string): string {
  const connection = useMachineStore.getState().connections[machineId];
  if (connection?.status !== 'online') {
    throw new MachineUnavailableError(getMachine(machineId)?.name ?? 'Machine');
  }
  return connection.routeUrl;
}

export function markMachineSessionRevoked(machineId: string): void {
  dropMachineAccess(machineId);
  useMachineStore.getState().setConnection(machineId, { status: 'session_revoked' });
}

async function renewMachineAccess(machineId: string): Promise<string> {
  const grant = await machineVault.refresh(machineId);
  storeMachineAccess(machineId, grant);
  return grant.access_token;
}

export async function refreshMachineAccess(machineId: string): Promise<string> {
  onlineRouteUrl(machineId);
  return renewMachineAccess(machineId);
}

export function isSessionLost(error: unknown): boolean {
  return (
    error instanceof MachineVaultError &&
    (error.code === 'session_revoked' || error.code === 'not_paired')
  );
}

export async function fetchHealth(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/health`, {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: unknown };
    return body.status === 'healthy';
  } catch {
    return false;
  }
}

export async function fetchInstanceId(origin: string): Promise<string | null> {
  try {
    const response = await fetch(`${origin}/api/v1/instance`, {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { instance_id?: unknown };
    return typeof body.instance_id === 'string' && body.instance_id ? body.instance_id : null;
  } catch {
    return null;
  }
}

export type RouteProbe =
  | { kind: 'ok'; routeUrl: string }
  | { kind: 'origin_blocked'; routeUrl: string }
  | { kind: 'unreachable'; tls: boolean };

export async function probeRoute(origin: string): Promise<RouteProbe> {
  if (await fetchHealth(origin)) return { kind: 'ok', routeUrl: origin };
  try {
    await machineVault.probe(origin);
    return { kind: 'origin_blocked', routeUrl: origin };
  } catch (error) {
    return { kind: 'unreachable', tls: error instanceof MachineVaultError && error.code === 'tls' };
  }
}

async function resolveConnection(machine: Machine): Promise<MachineConnection> {
  if (!machine.pairing) return { status: 'session_revoked' };

  let blockedRoute: string | null = null;
  let routeUrl: string | null = null;
  for (const route of machine.routes) {
    const probe = await probeRoute(route.url);
    if (probe.kind === 'ok') {
      routeUrl = probe.routeUrl;
      break;
    }
    if (probe.kind === 'origin_blocked') blockedRoute ??= probe.routeUrl;
  }
  if (!routeUrl) {
    return blockedRoute
      ? { status: 'origin_blocked', routeUrl: blockedRoute }
      : { status: 'offline' };
  }

  const instanceId = await fetchInstanceId(routeUrl);
  if (!instanceId) return { status: 'offline' };
  if (instanceId !== machine.pairing.instanceId) {
    dropMachineAccess(machine.id);
    return { status: 'different_server', routeUrl };
  }

  if (!hasFreshAccess(machine.id)) {
    try {
      await renewMachineAccess(machine.id);
    } catch (error) {
      if (isSessionLost(error)) {
        dropMachineAccess(machine.id);
        return { status: 'session_revoked' };
      }
      logger.error('Machine session refresh failed', 'machineSession', error);
      return { status: 'offline' };
    }
  }
  return { status: 'online', routeUrl };
}

function connectionIdentity(machine: Machine | undefined): string {
  return machine ? JSON.stringify([machine.pairing, machine.routes]) : '';
}

export function checkMachine(machineId: string): Promise<void> {
  const inflight = inflightChecks.get(machineId);
  if (inflight) return inflight;
  const machine = getMachine(machineId);
  if (!machine) return Promise.resolve();

  const store = useMachineStore.getState();
  if (!store.connections[machineId]) store.setConnection(machineId, { status: 'checking' });

  const identity = connectionIdentity(machine);
  const run = resolveConnection(machine).then((connection) => {
    inflightChecks.delete(machineId);
    const current = getMachine(machineId);
    if (!current) return;
    if (connectionIdentity(current) !== identity) return checkMachine(machineId);
    useMachineStore.getState().setConnection(machineId, connection);
  });
  inflightChecks.set(machineId, run);
  return run;
}
