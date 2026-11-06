import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Smartphone } from 'lucide-react';
import { ListManagementTab } from '@/components/ui/ListManagementTab/ListManagementTab';
import { CopyField } from '@/components/machines/CopyField';
import { useDevicesQuery, useRevokeDeviceMutation } from '@/hooks/queries/useDeviceQueries';
import { deviceService } from '@/services/deviceService';
import { buildPairingLink } from '@/utils/machineUrl';
import { getRelativeTime } from '@/utils/date';
import type { PairedDevice } from '@/types/machine.types';
import styles from './DevicesSettingsTab.module.scss';

interface ActivePairing {
  link: string;
  expiresAt: number;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function PairingLinkCard({
  pairing,
  onExpired,
}: {
  pairing: ActivePairing;
  onExpired: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const remaining = pairing.expiresAt - now;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (remaining <= 0) onExpired();
  }, [remaining, onExpired]);

  return (
    <div className={styles.pairing}>
      Paste this link into AgentRove on the device you&apos;re adding (Settings → Machines → Add
      machine). It works once and expires in{' '}
      <span className={styles.mono}>{formatCountdown(remaining)}</span>.
      <CopyField value={pairing.link} label="Copy pairing link" />
    </div>
  );
}

export function DevicesSettingsTab() {
  const { data: devices, error } = useDevicesQuery();
  const revokeDevice = useRevokeDeviceMutation();
  const [pairing, setPairing] = useState<ActivePairing | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handlePair = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const created = await deviceService.createPairingLink();
      setPairing({
        link: buildPairingLink(window.location.origin, created.secret),
        expiresAt: Date.parse(created.expires_at),
      });
    } catch (pairError) {
      toast.error(
        pairError instanceof Error ? pairError.message : 'Failed to create a pairing link',
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (index: number) => {
    const device = devices?.[index];
    if (!device) return;
    try {
      await revokeDevice.mutateAsync(device.id);
      toast.success(`Revoked ${device.name}`);
    } catch (revokeError) {
      toast.error(revokeError instanceof Error ? revokeError.message : 'Failed to revoke device');
    }
  };

  return (
    <ListManagementTab<PairedDevice>
      title="Devices"
      description="Apps paired with this server. Each one keeps its own session; revoke a device to sign it out."
      items={devices ?? (error ? [] : null)}
      emptyIcon={Smartphone}
      emptyText={error ? `Couldn't load devices: ${error.message}` : 'No paired devices yet'}
      emptyButtonText="Pair a Device"
      addButtonText="Pair a Device"
      deleteConfirmTitle="Revoke device"
      deleteConfirmMessage={(device) =>
        `Revoke ${device.name}? It's signed out immediately and has to be paired again.`
      }
      getItemKey={(device) => device.id}
      onAdd={() => void handlePair()}
      onDelete={handleRevoke}
      headerContent={
        pairing && <PairingLinkCard pairing={pairing} onExpired={() => setPairing(null)} />
      }
      renderItem={(device) => (
        <>
          <div className={styles['item-header']}>
            <h3 className={styles['item-title']}>{device.name}</h3>
            {device.current && <span className={styles.chip}>This device</span>}
          </div>
          <p className={styles['item-meta']}>
            Paired {getRelativeTime(device.created_at)} · Last used{' '}
            {device.last_used_at ? getRelativeTime(device.last_used_at) : 'never'}
          </p>
        </>
      )}
      logContext="DevicesSettingsTab"
    />
  );
}
