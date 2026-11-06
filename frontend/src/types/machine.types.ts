export const LOCAL_MACHINE_ID = 'local';

export type MachineRouteKind = 'tailscale' | 'https';

export interface MachineRoute {
  kind: MachineRouteKind;
  url: string;
}

export interface MachinePairing {
  instanceId: string;
  deviceId: string;
  pairedAt: string;
}

export interface Machine {
  id: string;
  name: string;
  routes: MachineRoute[];
  pairing: MachinePairing | null;
}

export type MachineConnection =
  | { status: 'checking' }
  | { status: 'online'; routeUrl: string }
  | { status: 'offline' }
  | { status: 'session_revoked' }
  | { status: 'origin_blocked'; routeUrl: string }
  | { status: 'different_server'; routeUrl: string };

export type MachineStatus = MachineConnection['status'];

export interface PairedDevice {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  current: boolean;
}

export interface PairingLink {
  secret: string;
  expires_at: string;
}
