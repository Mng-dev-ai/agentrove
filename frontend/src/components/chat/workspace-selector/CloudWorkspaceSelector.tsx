import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cloud } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { useCloudWorkspacesQuery } from '@/hooks/queries/useCloudQueries';
import { WorkspacePicker } from './WorkspacePicker';
import styles from './CloudWorkspaceSelector.module.scss';

interface CloudWorkspaceSelectorProps {
  selectedWorkspaceId: string | null;
  onWorkspaceChange: (id: string) => void;
  disabled?: boolean;
}

export function CloudWorkspaceSelector({
  selectedWorkspaceId,
  onWorkspaceChange,
  disabled = false,
}: CloudWorkspaceSelectorProps) {
  const navigate = useNavigate();
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);
  const isConnected = !!connectedEmail;
  const { data: workspaces = [], isLoading, error } = useCloudWorkspacesQuery(isConnected);

  // Default to the first VPS workspace once the list loads and none is chosen.
  useEffect(() => {
    if (!workspaces.length) return;
    if (selectedWorkspaceId && workspaces.some((ws) => ws.id === selectedWorkspaceId)) return;
    onWorkspaceChange(workspaces[0].id);
  }, [workspaces, selectedWorkspaceId, onWorkspaceChange]);

  if (!isConnected) {
    return (
      <Button
        type="button"
        variant="unstyled"
        onClick={() => navigate('/settings', { state: { tab: 'cloud' } })}
        className={styles['connect-button']}
      >
        <Cloud className={styles['connect-icon']} />
        Connect a cloud instance
      </Button>
    );
  }

  if (error) {
    return <span className={styles['error-message']}>Couldn&apos;t reach cloud instance</span>;
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
