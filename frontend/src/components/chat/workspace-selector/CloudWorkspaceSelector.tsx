import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cloud } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { useCloudWorkspacesQuery } from '@/hooks/queries/useCloudQueries';
import { WorkspacePicker } from './WorkspacePicker';

interface CloudWorkspaceSelectorProps {
  selectedWorkspaceId: string | null;
  onWorkspaceChange: (id: string) => void;
  disabled?: boolean;
}

// Shown on the landing composer when running on cloud: pick a workspace that
// exists on the VPS, or prompt the user to connect a cloud instance first.
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
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
      >
        <Cloud className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
        Connect a cloud instance
      </Button>
    );
  }

  if (error) {
    return (
      <span className="px-1.5 py-1 text-2xs text-error-600 dark:text-error-400">
        Couldn&apos;t reach cloud instance
      </span>
    );
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
