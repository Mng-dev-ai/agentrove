import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog/ConfirmDialog';
import { CopyField } from '@/components/machines/CopyField';
import { useDevicesQuery, useRevokeDeviceMutation } from '@/hooks/queries/useDeviceQueries';
import { deviceService } from '@/services/deviceService';
import { buildPairingLink } from '@/utils/machineUrl';
import { getRelativeTime } from '@/utils/date';
import type { PairedDevice } from '@/types/machine.types';
import styles from '@/components/settings/tabs/MachinesSettingsTab/MachinesSettingsTab.module.scss';

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
  const { data: devices, isLoading, error } = useDevicesQuery();
  const revokeDevice = useRevokeDeviceMutation();
  const [pairing, setPairing] = useState<ActivePairing | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [revoking, setRevoking] = useState<PairedDevice | null>(null);

  const handlePair = async () => {
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

  const handleRevoke = async (device: PairedDevice) => {
    setRevoking(null);
    try {
      await revokeDevice.mutateAsync(device.id);
      toast.success(`Revoked ${device.name}`);
    } catch (revokeError) {
      toast.error(revokeError instanceof Error ? revokeError.message : 'Failed to revoke device');
    }
  };

  return (
    <div className={styles.machines}>
      <div className={styles.card}>
        <div className={styles['instance-header']}>
          <h2 className={styles['instance-title']}>Devices</h2>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void handlePair()}
            isLoading={isCreating}
            loadingText="Creating..."
          >
            Pair a device
          </Button>
        </div>
        <p className={styles['instance-desc']}>
          Apps paired with this server. Each one keeps its own session; revoke a device to sign it
          out.
        </p>
        {pairing && <PairingLinkCard pairing={pairing} onExpired={() => setPairing(null)} />}

        <div className={styles.list}>
          {isLoading && <p className={styles.empty}>Loading devices…</p>}
          {error && <p className={styles.empty}>Couldn&apos;t load devices: {error.message}</p>}
          {devices?.length === 0 && <p className={styles.empty}>No paired devices yet.</p>}
          {devices?.map((device) => (
            <div key={device.id} className={clsx(styles.item, styles.row)}>
              <div className={styles['row-main']}>
                <div className={styles['row-title']}>
                  <span className={styles.name}>{device.name}</span>
                  {device.current && <span className={styles.badge}>This device</span>}
                </div>
                <span className={styles.host}>
                  Paired {getRelativeTime(device.created_at)} · Last used{' '}
                  {device.last_used_at ? getRelativeTime(device.last_used_at) : 'never'}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRevoking(device)}
                disabled={revokeDevice.isPending}
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      </div>
      <ConfirmDialog
        isOpen={!!revoking}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && void handleRevoke(revoking)}
        title="Revoke device"
        message={`Revoke ${revoking?.name ?? 'this device'}? It's signed out immediately and has to be paired again.`}
        confirmLabel="Revoke"
      />
    </div>
  );
}
