import { useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { KeyRound, Server, Star } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { ListManagementTab } from '@/components/ui/ListManagementTab/ListManagementTab';
import { RenameModal } from '@/components/ui/RenameModal/RenameModal';
import { MachineStatusDot } from '@/components/machines/MachineStatusDot';
import { MACHINE_STATUS_LABEL } from '@/components/machines/machineStatusLabel';
import { AddMachineDialog } from '@/components/machines/AddMachineDialog';
import { CopyField } from '@/components/machines/CopyField';
import {
  useMachineActiveStreamsQuery,
  useMachineChatsTotalQuery,
} from '@/hooks/queries/useMachineQueries';
import { removeMachine } from '@/services/machineActions';
import { LOCAL_MACHINE_NAME, useMachineStore } from '@/store/machineStore';
import { hostOf } from '@/utils/machineUrl';
import {
  LOCAL_MACHINE_ID,
  type Machine,
  type MachineConnection,
  type MachineStatus,
} from '@/types/machine.types';
import styles from './MachinesSettingsTab.module.scss';

function ChatCounts({ machineId, online }: { machineId: string; online: boolean }) {
  const { data: running } = useMachineActiveStreamsQuery(machineId, online);
  const { data: total } = useMachineChatsTotalQuery(machineId, online);
  return (
    <span className={styles.counts}>
      {running?.length ?? '—'} running · {total ?? '—'} chats
    </span>
  );
}

function ConnectionNotice({ connection }: { connection: MachineConnection | undefined }) {
  if (connection?.status === 'origin_blocked') {
    return (
      <div className={styles.notice}>
        Add this app&apos;s origin to the server&apos;s{' '}
        <span className={styles.mono}>ALLOWED_ORIGINS</span> and restart it:
        <CopyField
          value={`ALLOWED_ORIGINS=${window.location.origin}`}
          label="Copy ALLOWED_ORIGINS"
        />
      </div>
    );
  }
  if (connection?.status === 'different_server') {
    return (
      <p className={styles.notice}>
        This route now answers as a different AgentRove server, so requests to it are blocked.
      </p>
    );
  }
  if (connection?.status === 'session_revoked') {
    return (
      <p className={styles.notice}>
        This device isn&apos;t paired anymore. Pair it again to reconnect.
      </p>
    );
  }
  return null;
}

function MachineSummary({
  status,
  name,
  host,
  isDefault,
  children,
}: {
  status: MachineStatus;
  name: string;
  host: string;
  isDefault: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <MachineStatusDot status={status} />
      <div className={styles['row-main']}>
        <div className={styles['row-title']}>
          <h3 className={styles.name}>{name}</h3>
          {isDefault && <span className={styles.chip}>Default</span>}
        </div>
        <span className={styles.host}>{host}</span>
      </div>
      {children}
    </div>
  );
}

function SetDefaultButton({
  machine,
  isDefault,
}: {
  machine: Pick<Machine, 'id' | 'name'>;
  isDefault: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={styles['action-btn']}
      aria-label={`Set ${machine.name} as default`}
      title="Set as default"
      disabled={isDefault}
      onClick={() => useMachineStore.getState().setDefaultMachine(machine.id)}
    >
      <Star className={styles['action-icon']} />
    </Button>
  );
}

export function MachinesSettingsTab() {
  const machines = useMachineStore((state) => state.machines);
  const connections = useMachineStore((state) => state.connections);
  const defaultMachineId = useMachineStore((state) => state.defaultMachineId);

  const [pairTarget, setPairTarget] = useState<{ machineId: string | null } | null>(null);
  const [renaming, setRenaming] = useState<Machine | null>(null);

  const handleRemove = async (index: number) => {
    const machine = machines[index];
    const wasPaired = connections[machine.id]?.status !== 'session_revoked' && !!machine.pairing;
    const { revoked } = await removeMachine(machine.id);
    if (!revoked && wasPaired) {
      toast.error(
        `Removed ${machine.name} here, but it couldn't be revoked on the server. Revoke this device in its Settings → Devices.`,
      );
    } else {
      toast.success(`Removed ${machine.name}`);
    }
  };

  return (
    <>
      <ListManagementTab<Machine>
        title="Machines"
        description="Run chats on several AgentRove instances at once — this computer, a VPS, a cloud VM — reached over Tailscale or https."
        items={machines}
        emptyIcon={Server}
        emptyText="No remote machines added yet"
        emptyButtonText="Add Your First Machine"
        addButtonText="Add Machine"
        deleteConfirmTitle="Remove machine"
        deleteConfirmMessage={(machine) =>
          `Remove ${machine.name}? This device is revoked on the server when it's reachable. Its chats stay listed as a removed machine until you pair the same server again, and chats on the machine itself are kept.`
        }
        getItemKey={(machine) => machine.id}
        onAdd={() => setPairTarget({ machineId: null })}
        onEdit={(index) => setRenaming(machines[index])}
        onDelete={handleRemove}
        headerContent={
          <div className={styles.header}>
            <div className={styles['local-card']}>
              <MachineSummary
                status="online"
                name={LOCAL_MACHINE_NAME}
                host="Local"
                isDefault={defaultMachineId === LOCAL_MACHINE_ID}
              >
                <ChatCounts machineId={LOCAL_MACHINE_ID} online />
              </MachineSummary>
              <SetDefaultButton
                machine={{ id: LOCAL_MACHINE_ID, name: LOCAL_MACHINE_NAME }}
                isDefault={defaultMachineId === LOCAL_MACHINE_ID}
              />
            </div>
          </div>
        }
        renderItem={(machine) => {
          const connection = connections[machine.id];
          const status = connection?.status ?? 'checking';
          return (
            <>
              <MachineSummary
                status={status}
                name={machine.name}
                host={hostOf(machine.url)}
                isDefault={defaultMachineId === machine.id}
              >
                {status === 'online' ? (
                  <ChatCounts machineId={machine.id} online />
                ) : status === 'session_revoked' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPairTarget({ machineId: machine.id })}
                  >
                    Pair again
                  </Button>
                ) : (
                  <span className={styles['status-pill']}>{MACHINE_STATUS_LABEL[status]}</span>
                )}
              </MachineSummary>
              <ConnectionNotice connection={connection} />
            </>
          );
        }}
        renderItemActions={(machine) => (
          <>
            <SetDefaultButton machine={machine} isDefault={defaultMachineId === machine.id} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={styles['action-btn']}
              aria-label={`Pair ${machine.name} again`}
              title="Pair again"
              onClick={() => setPairTarget({ machineId: machine.id })}
            >
              <KeyRound className={styles['action-icon']} />
            </Button>
          </>
        )}
        logContext="MachinesSettingsTab"
      />
      {pairTarget && (
        <AddMachineDialog
          repairMachineId={pairTarget.machineId}
          onClose={() => setPairTarget(null)}
        />
      )}
      <RenameModal
        isOpen={!!renaming}
        onClose={() => setRenaming(null)}
        onSave={async (name) => {
          if (renaming && name.trim()) {
            useMachineStore.getState().updateMachine(renaming.id, { name: name.trim() });
          }
          setRenaming(null);
        }}
        currentTitle={renaming?.name ?? ''}
        title="Rename machine"
      />
    </>
  );
}
