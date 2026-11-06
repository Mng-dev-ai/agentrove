import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Edit2, KeyRound, MoreHorizontal, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog/ConfirmDialog';
import { RenameModal } from '@/components/ui/RenameModal/RenameModal';
import { SidebarMenu, SidebarMenuItem } from '@/components/layout/Sidebar/SidebarMenu';
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
import { LOCAL_MACHINE_ID, type Machine, type MachineConnection } from '@/types/machine.types';
import styles from './MachinesSettingsTab.module.scss';

interface MenuState {
  machineId: string;
  position: { top: number; left: number };
}

const MENU_WIDTH = 176;

function activeHost(machine: Machine, connection: MachineConnection | undefined): string {
  if (connection && 'routeUrl' in connection) return hostOf(connection.routeUrl);
  return machine.routes[0] ? hostOf(machine.routes[0].url) : 'No route';
}

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

export function MachinesSettingsTab() {
  const machines = useMachineStore((state) => state.machines);
  const connections = useMachineStore((state) => state.connections);
  const defaultMachineId = useMachineStore((state) => state.defaultMachineId);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pairTarget, setPairTarget] = useState<{ machineId: string | null } | null>(null);
  const [renaming, setRenaming] = useState<Machine | null>(null);
  const [removing, setRemoving] = useState<Machine | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handlePointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', handlePointer);
    return () => document.removeEventListener('mousedown', handlePointer);
  }, [menu]);

  const openMenu = (machineId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      machineId,
      position: { top: rect.bottom + 4, left: Math.max(8, rect.right - MENU_WIDTH) },
    });
  };

  const menuMachine = menu ? machines.find((machine) => machine.id === menu.machineId) : undefined;

  const handleRemove = async (machine: Machine) => {
    setRemoving(null);
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
    <div className={styles.machines}>
      <div className={styles.card}>
        <div className={styles['instance-header']}>
          <h2 className={styles['instance-title']}>Machines</h2>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setPairTarget({ machineId: null })}
          >
            Add machine
          </Button>
        </div>
        <p className={styles['instance-desc']}>
          Run chats on several AgentRove instances at once — this computer, a VPS, a cloud VM —
          reached over Tailscale or https.
        </p>

        <div className={styles.list}>
          <div className={clsx(styles.item, styles.row)}>
            <MachineStatusDot status="online" />
            <div className={styles['row-main']}>
              <div className={styles['row-title']}>
                <span className={styles.name}>{LOCAL_MACHINE_NAME}</span>
                {defaultMachineId === LOCAL_MACHINE_ID && (
                  <span className={styles.badge}>Default</span>
                )}
              </div>
              <span className={styles.host}>Local</span>
            </div>
            <ChatCounts machineId={LOCAL_MACHINE_ID} online />
            <Button
              type="button"
              variant="unstyled"
              className={styles['menu-button']}
              aria-label={`${LOCAL_MACHINE_NAME} options`}
              onClick={(event) => openMenu(LOCAL_MACHINE_ID, event)}
            >
              <MoreHorizontal className={styles['menu-icon']} />
            </Button>
          </div>

          {machines.map((machine) => {
            const connection = connections[machine.id];
            const status = connection?.status ?? 'checking';
            return (
              <div key={machine.id} className={styles.item}>
                <div className={styles.row}>
                  <MachineStatusDot status={status} />
                  <div className={styles['row-main']}>
                    <div className={styles['row-title']}>
                      <span className={styles.name}>{machine.name}</span>
                      {defaultMachineId === machine.id && (
                        <span className={styles.badge}>Default</span>
                      )}
                    </div>
                    <span className={styles.host}>{activeHost(machine, connection)}</span>
                  </div>
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
                    <span className={styles['status-pill']}>
                      <MachineStatusDot status={status} />
                      {MACHINE_STATUS_LABEL[status]}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="unstyled"
                    className={styles['menu-button']}
                    aria-label={`${machine.name} options`}
                    onClick={(event) => openMenu(machine.id, event)}
                  >
                    <MoreHorizontal className={styles['menu-icon']} />
                  </Button>
                </div>
                <ConnectionNotice connection={connection} />
              </div>
            );
          })}
        </div>
      </div>

      {menu && (
        <SidebarMenu ref={menuRef} position={menu.position} onClose={() => setMenu(null)}>
          <SidebarMenuItem
            icon={Star}
            disabled={defaultMachineId === menu.machineId}
            onClick={() => {
              useMachineStore.getState().setDefaultMachine(menu.machineId);
              setMenu(null);
            }}
          >
            Set as default
          </SidebarMenuItem>
          {menuMachine && (
            <>
              <SidebarMenuItem
                icon={Edit2}
                onClick={() => {
                  setRenaming(menuMachine);
                  setMenu(null);
                }}
              >
                Rename
              </SidebarMenuItem>
              <SidebarMenuItem
                icon={KeyRound}
                onClick={() => {
                  setPairTarget({ machineId: menuMachine.id });
                  setMenu(null);
                }}
              >
                Pair again
              </SidebarMenuItem>
              <SidebarMenuItem
                icon={Trash2}
                danger
                onClick={() => {
                  setRemoving(menuMachine);
                  setMenu(null);
                }}
              >
                Remove
              </SidebarMenuItem>
            </>
          )}
        </SidebarMenu>
      )}

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
      <ConfirmDialog
        isOpen={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && void handleRemove(removing)}
        title="Remove machine"
        message={`Remove ${removing?.name ?? 'this machine'}? This device is revoked on the server when it's reachable, and its chats disappear from this app. Chats on the machine itself are kept.`}
        confirmLabel="Remove"
      />
    </div>
  );
}
