export const LOCAL_MACHINE_ID = 'local';

export interface MachineQueryOptions {
  enabled?: boolean;
  machineId?: string;
}

export interface MachinePairing {
  instanceId: string;
  deviceId: string;
  pairedAt: string;
}

export interface Machine {
  id: string;
  name: string;
  url: string;
  pairing: MachinePairing | null;
}

export type MachineConnection =
  | { status: 'checking' }
  | { status: 'online' }
  | { status: 'offline' }
  | { status: 'session_revoked' }
  | { status: 'origin_blocked' }
  | { status: 'different_server' };

export type MachineStatus = MachineConnection['status'];

export interface PairedDevice {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  current: boolean;
}

export interface InstanceInfo {
  instance_id: string;
  max_upload_size?: number;
  allowed_file_types?: string[];
}

export interface UploadLimits {
  maxUploadSize: number;
  allowedFileTypes: readonly string[];
}

export interface PairingLink {
  secret: string;
  expires_at: string;
}
