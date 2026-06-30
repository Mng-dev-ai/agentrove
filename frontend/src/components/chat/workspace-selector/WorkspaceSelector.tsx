import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
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

  return (
    <WorkspacePicker
      workspaces={workspaces}
      selectedWorkspaceId={selectedWorkspaceId}
      onSelect={onWorkspaceChange}
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
