import { useWorkspacesList, useWorkspacesQuery } from '@/hooks/queries/useWorkspaceQueries';
import { WorkspacePicker } from './WorkspacePicker';
import { CreateWorkspaceFooter } from './CreateWorkspaceFooter';

interface WorkspaceSelectorProps {
  selectedWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string | null) => void;
  enabled: boolean;
}

export function WorkspaceSelector({
  selectedWorkspaceId,
  onWorkspaceChange,
  enabled,
}: WorkspaceSelectorProps) {
  const workspaces = useWorkspacesList({ enabled });
  const { isLoading } = useWorkspacesQuery({ enabled });

  return (
    <WorkspacePicker
      workspaces={workspaces}
      selectedWorkspaceId={selectedWorkspaceId}
      onSelect={onWorkspaceChange}
      isLoading={isLoading}
      showBranches
      footer={(close) => (
        <CreateWorkspaceFooter
          onCreated={(id) => {
            onWorkspaceChange(id);
            close();
          }}
        />
      )}
    />
  );
}
