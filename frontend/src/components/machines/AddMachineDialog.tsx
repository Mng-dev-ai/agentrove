import { useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronRight, Server } from 'lucide-react';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { DialogFooter } from '@/components/ui/shared/DialogFooter/DialogFooter';
import { Input } from '@/components/ui/primitives/Input/Input';
import { Label } from '@/components/ui/primitives/Label/Label';
import { Button } from '@/components/ui/primitives/Button/Button';
import { PairError, pairMachine, type PairFailure } from '@/services/machineActions';
import { getMachine } from '@/store/machineStore';
import { hostOf, parsePairingLink } from '@/utils/machineUrl';
import { CopyField } from './CopyField';
import styles from './AddMachineDialog.module.scss';

interface AddMachineDialogProps {
  repairMachineId: string | null;
  onClose: () => void;
}

function PairFailureMessage({
  failure,
  onRepair,
}: {
  failure: PairFailure;
  onRepair: (machineId: string) => void;
}) {
  switch (failure.kind) {
    case 'invalid_link':
      return (
        <p>
          This pairing link is invalid, expired, or already used. Create a new one on the server.
        </p>
      );
    case 'not_https':
      return <p>Pairing links must use https://.</p>;
    case 'origin_blocked':
      return (
        <>
          <p>
            {hostOf(failure.origin)} is reachable but doesn&apos;t accept requests from this app.
            Add this app&apos;s origin to the server&apos;s environment and restart it:
          </p>
          <CopyField
            value={`ALLOWED_ORIGINS=${window.location.origin}`}
            label="Copy ALLOWED_ORIGINS"
          />
        </>
      );
    case 'unreachable':
      return (
        <p>
          Couldn&apos;t reach {hostOf(failure.origin)}. Check the link and that the server (and
          Tailscale, if you use it) is running.
        </p>
      );
    case 'tls':
      return <p>The TLS certificate of {hostOf(failure.origin)} was rejected.</p>;
    case 'different_server':
      return (
        <p>
          {hostOf(failure.origin)} is a different AgentRove server than the one this machine was
          paired with.
        </p>
      );
    case 'duplicate':
      return <p>This server is already added as “{failure.name}”.</p>;
    case 'unpaired_duplicate':
      return (
        <>
          <p>This server is already added as “{failure.name}”, which isn&apos;t paired yet.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onRepair(failure.machineId)}
          >
            Pair “{failure.name}” again
          </Button>
        </>
      );
    case 'keychain':
      return <p>Couldn&apos;t store the pairing in the system keychain: {failure.message}</p>;
    case 'other':
      return <p>{failure.message}</p>;
  }
}

export function AddMachineDialog({ repairMachineId, onClose }: AddMachineDialogProps) {
  const [repairId, setRepairId] = useState(repairMachineId);
  const repairing = repairId ? getMachine(repairId) : undefined;
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [failure, setFailure] = useState<PairFailure | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const parsedLink = parsePairingLink(link);
  const canSubmit = !!link.trim() && (!!repairing || !!name.trim());

  const handleConnect = async () => {
    setFailure(null);
    setIsConnecting(true);
    try {
      const machine = await pairMachine(
        repairing ? { mode: 'repair', machineId: repairing.id, link } : { mode: 'add', name, link },
      );
      setLink('');
      toast.success(`Paired with ${machine.name}`);
      onClose();
    } catch (error) {
      setFailure(
        error instanceof PairError
          ? error.failure
          : { kind: 'other', message: error instanceof Error ? error.message : 'Pairing failed' },
      );
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} size="sm" ariaLabel="Add machine">
      <div className={styles.body}>
        <div className={styles.header}>
          <div className={styles['icon-box']}>
            <Server className={styles['header-icon']} />
          </div>
          <h3 className={styles.title}>
            {repairing ? `Pair ${repairing.name} again` : 'Add machine'}
          </h3>
        </div>

        {failure && (
          <div className={styles.error} role="alert">
            <PairFailureMessage
              failure={failure}
              onRepair={(machineId) => {
                setRepairId(machineId);
                setFailure(null);
              }}
            />
          </div>
        )}

        <div className={styles.fields}>
          {!repairing && (
            <div>
              <Label className={styles.label}>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VPS"
                autoComplete="off"
              />
            </div>
          )}
          <div>
            <Label className={styles.label}>Pairing link</Label>
            <Input
              type="password"
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setFailure(null);
              }}
              placeholder="https://your-server.ts.net/#pair=…"
              autoComplete="off"
              spellCheck={false}
            />
            {parsedLink.ok && (
              <p className={styles.hint}>
                Server: <span className={styles.mono}>{hostOf(parsedLink.origin)}</span>
              </p>
            )}
          </div>
          <details className={styles.help}>
            <summary className={styles['help-summary']}>
              <ChevronRight className={styles['help-chevron']} />
              Where do I get a pairing link?
            </summary>
            <p className={styles['help-text']}>
              Open the server&apos;s Settings → Devices → Pair a device, or run{' '}
              <code className={styles.mono}>python -m app.cli pair --email you@example.com</code> on
              it. Links work once and expire after 5 minutes.
            </p>
          </details>
        </div>
      </div>
      <DialogFooter
        onCancel={onClose}
        onSave={() => void handleConnect()}
        saveLabel="Connect"
        saving={isConnecting}
        disabled={!canSubmit || isConnecting}
        bordered
      />
    </BaseModal>
  );
}
