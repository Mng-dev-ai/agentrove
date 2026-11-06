import type { MachineStatus } from '@/types/machine.types';

export const MACHINE_STATUS_LABEL: Record<MachineStatus, string> = {
  online: 'Connected',
  checking: 'Checking…',
  offline: 'Offline',
  session_revoked: 'Pair again',
  origin_blocked: 'Origin not allowed',
  different_server: 'Different server',
};
