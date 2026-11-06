import { useEffect } from 'react';
import { useMachineWorkspacesQuery } from '@/hooks/queries/useMachineQueries';
import { useMachineName } from '@/store/machineStore';
import { WorkspacePicker } from './WorkspacePicker';
import styles from './MachineWorkspaceSelector.module.scss';

interface MachineWorkspaceSelectorProps {
  machineId: string;
  selectedWorkspaceId: string | null;
  onWorkspaceChange: (id: string) => void;
  disabled?: boolean;
}

export function MachineWorkspaceSelector({
  machineId,
  selectedWorkspaceId,
  onWorkspaceChange,
  disabled = false,
}: MachineWorkspaceSelectorProps) {
  const name = useMachineName(machineId);
  const { data: workspaces = [], isLoading, error } = useMachineWorkspacesQuery(machineId, true);

  useEffect(() => {
    if (!workspaces.length) return;
    if (selectedWorkspaceId && workspaces.some((ws) => ws.id === selectedWorkspaceId)) return;
    onWorkspaceChange(workspaces[0].id);
  }, [workspaces, selectedWorkspaceId, onWorkspaceChange]);

  if (error) {
    return <span className={styles['error-message']}>Couldn&apos;t reach {name}</span>;
  }

  return (
    <WorkspacePicker
      workspaces={workspaces}
      selectedWorkspaceId={selectedWorkspaceId}
      onSelect={onWorkspaceChange}
      isLoading={isLoading}
      triggerDisabled={disabled || isLoading || workspaces.length === 0}
      showBranches={false}
    />
  );
}
