import { useState, useRef, useCallback, type RefObject } from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';
import type { NavigateFunction } from 'react-router-dom';
import type { Workspace } from '@/types/workspace.types';
import {
  useDeleteWorkspaceMutation,
  useUpdateWorkspaceMutation,
} from '@/hooks/queries/useWorkspaceQueries';
import {
  useMachineUpdateWorkspaceMutation,
  useMachineDeleteWorkspaceMutation,
} from '@/hooks/queries/useMachineQueries';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import { useUIStore } from '@/store/uiStore';
import { mutateWithToast } from './sidebarHelpers';

interface UseSidebarWorkspaceActionsParams {
  selectedChatId: string | null;
  selectedChannelId: string | null;
  selectedChatWorkspaceId?: string | null;
  isMobile: boolean;
  navigate: NavigateFunction;
  workspaceBadgeById: Map<string, WorkspaceBadge>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

export function useSidebarWorkspaceActions({
  selectedChatId,
  selectedChannelId,
  selectedChatWorkspaceId,
  isMobile,
  navigate,
  workspaceBadgeById,
  scrollContainerRef,
}: UseSidebarWorkspaceActionsParams) {
  const [workspaceToDelete, setWorkspaceToDelete] = useState<{
    id: string;
    machineId: string;
  } | null>(null);
  const [workspaceToRename, setWorkspaceToRename] = useState<{
    workspace: Workspace;
    machineId: string;
  } | null>(null);
  const [workspaceDropdown, setWorkspaceDropdown] = useState<{
    workspaceId: string;
    machineId: string;
    position: { top: number; left: number };
  } | null>(null);

  const workspaceDropdownRef = useRef<HTMLDivElement>(null);
  const deleteWorkspace = useDeleteWorkspaceMutation();
  const updateWorkspace = useUpdateWorkspaceMutation();
  const machineUpdateWorkspace = useMachineUpdateWorkspaceMutation();
  const machineDeleteWorkspace = useMachineDeleteWorkspaceMutation();

  useMountEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        workspaceDropdownRef.current &&
        !workspaceDropdownRef.current.contains(event.target as Node)
      ) {
        setWorkspaceDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  });

  const wsDropdownStateRef = useRef(workspaceDropdown);
  wsDropdownStateRef.current = workspaceDropdown;

  useMountEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      if (wsDropdownStateRef.current) setWorkspaceDropdown(null);
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  });

  const handleNewWorkspaceThread = useCallback(
    (workspaceId: string, machineId: string = LOCAL_MACHINE_ID) => {
      // Landing composer switches to the owning machine and preselects this workspace.
      navigate('/', { state: { workspaceId, machineId } });
      if (isMobile) {
        useUIStore.getState().setSidebarOpen(false);
      }
    },
    [navigate, isMobile],
  );

  const openWorkspaceMenu = useCallback(
    (workspaceId: string, position: { top: number; left: number }) => {
      const machineId = workspaceBadgeById.get(workspaceId)?.machineId ?? LOCAL_MACHINE_ID;
      setWorkspaceDropdown({ workspaceId, machineId, position });
    },
    [workspaceBadgeById],
  );

  const handleRenameWorkspace = useCallback((workspace: Workspace, machineId: string) => {
    setWorkspaceToRename({ workspace, machineId });
    setWorkspaceDropdown(null);
  }, []);

  const handleSaveWorkspaceRename = useCallback(
    async (newName: string) => {
      if (!workspaceToRename) return;
      const { workspace, machineId } = workspaceToRename;
      const data = { name: newName };
      try {
        await mutateWithToast(
          () =>
            machineId === LOCAL_MACHINE_ID
              ? updateWorkspace.mutateAsync({ workspaceId: workspace.id, data })
              : machineUpdateWorkspace.mutateAsync({ machineId, workspaceId: workspace.id, data }),
          'Workspace renamed',
          'Failed to rename workspace',
        );
      } catch {
        // toast already shown by mutateWithToast
      } finally {
        setWorkspaceToRename(null);
      }
    },
    [workspaceToRename, updateWorkspace, machineUpdateWorkspace],
  );

  const handleDeleteWorkspace = useCallback((workspaceId: string, machineId: string) => {
    setWorkspaceToDelete({ id: workspaceId, machineId });
    setWorkspaceDropdown(null);
  }, []);

  const confirmDeleteWorkspace = useCallback(async () => {
    if (!workspaceToDelete) return;
    const { id, machineId } = workspaceToDelete;
    try {
      await mutateWithToast(
        () =>
          machineId === LOCAL_MACHINE_ID
            ? deleteWorkspace.mutateAsync(id)
            : machineDeleteWorkspace.mutateAsync({ machineId, workspaceId: id }),
        'Workspace deleted',
        'Failed to delete workspace',
      );
      if ((selectedChatId || selectedChannelId) && selectedChatWorkspaceId === id) {
        navigate('/');
      }
    } catch {
      // toast already shown by mutateWithToast
    } finally {
      setWorkspaceToDelete(null);
    }
  }, [
    workspaceToDelete,
    deleteWorkspace,
    machineDeleteWorkspace,
    selectedChatId,
    selectedChannelId,
    selectedChatWorkspaceId,
    navigate,
  ]);

  return {
    workspaceDropdown,
    setWorkspaceDropdown,
    workspaceDropdownRef,
    workspaceToDelete,
    setWorkspaceToDelete,
    workspaceToRename,
    setWorkspaceToRename,
    updateWorkspace,
    machineUpdateWorkspace,
    handleNewWorkspaceThread,
    openWorkspaceMenu,
    handleRenameWorkspace,
    handleSaveWorkspaceRename,
    handleDeleteWorkspace,
    confirmDeleteWorkspace,
  };
}

export type SidebarWorkspaceActions = ReturnType<typeof useSidebarWorkspaceActions>;
