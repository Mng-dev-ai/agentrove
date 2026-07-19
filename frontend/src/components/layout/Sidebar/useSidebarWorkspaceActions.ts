import { useState, useRef, useCallback, type RefObject } from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';
import type { NavigateFunction } from 'react-router-dom';
import type { Workspace } from '@/types/workspace.types';
import {
  useDeleteWorkspaceMutation,
  useUpdateWorkspaceMutation,
} from '@/hooks/queries/useWorkspaceQueries';
import {
  useCloudUpdateWorkspaceMutation,
  useCloudDeleteWorkspaceMutation,
} from '@/hooks/queries/useCloudQueries';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import { useUIStore } from '@/store/uiStore';
import { mutateWithToast, calculateDropdownPosition } from './sidebarHelpers';

interface UseSidebarWorkspaceActionsParams {
  selectedChatId: string | null;
  selectedChatWorkspaceId?: string | null;
  isMobile: boolean;
  navigate: NavigateFunction;
  workspaceBadgeById: Map<string, WorkspaceBadge>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

export function useSidebarWorkspaceActions({
  selectedChatId,
  selectedChatWorkspaceId,
  isMobile,
  navigate,
  workspaceBadgeById,
  scrollContainerRef,
}: UseSidebarWorkspaceActionsParams) {
  const [workspaceToDelete, setWorkspaceToDelete] = useState<{
    id: string;
    isCloud: boolean;
  } | null>(null);
  const [workspaceToRename, setWorkspaceToRename] = useState<{
    workspace: Workspace;
    isCloud: boolean;
  } | null>(null);
  const [workspaceDropdown, setWorkspaceDropdown] = useState<{
    workspaceId: string;
    isCloud: boolean;
    position: { top: number; left: number };
  } | null>(null);

  const workspaceDropdownRef = useRef<HTMLDivElement>(null);
  const deleteWorkspace = useDeleteWorkspaceMutation();
  const updateWorkspace = useUpdateWorkspaceMutation();
  const cloudUpdateWorkspace = useCloudUpdateWorkspaceMutation();
  const cloudDeleteWorkspace = useCloudDeleteWorkspaceMutation();

  useMountEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        workspaceDropdownRef.current &&
        !workspaceDropdownRef.current.contains(event.target as Node) &&
        !(event.target as HTMLElement).closest('[data-ws-dropdown-trigger]')
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
    (e: React.MouseEvent, workspaceId: string) => {
      e.stopPropagation();
      navigate('/', { state: { workspaceId } });
      if (isMobile) {
        useUIStore.getState().setSidebarOpen(false);
      }
    },
    [navigate, isMobile],
  );

  const handleNewCloudThread = useCallback(
    (e: React.MouseEvent, workspaceId: string) => {
      e.stopPropagation();
      // Landing composer flips to cloud and preselects this VPS workspace.
      navigate('/', { state: { cloudWorkspaceId: workspaceId } });
      if (isMobile) {
        useUIStore.getState().setSidebarOpen(false);
      }
    },
    [navigate, isMobile],
  );

  const handleWorkspaceContextMenu = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, workspaceId: string) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const isCloud = workspaceBadgeById.get(workspaceId)?.isCloud ?? false;
      setWorkspaceDropdown((prev) => {
        if (prev?.workspaceId === workspaceId) return null;
        const position = calculateDropdownPosition(rect);
        return { workspaceId, isCloud, position };
      });
    },
    [workspaceBadgeById],
  );

  const handleRenameWorkspace = useCallback((workspace: Workspace, isCloud: boolean) => {
    setWorkspaceToRename({ workspace, isCloud });
    setWorkspaceDropdown(null);
  }, []);

  const handleSaveWorkspaceRename = useCallback(
    async (newName: string) => {
      if (!workspaceToRename) return;
      const { workspace, isCloud } = workspaceToRename;
      const mutation = isCloud ? cloudUpdateWorkspace : updateWorkspace;
      try {
        await mutateWithToast(
          () => mutation.mutateAsync({ workspaceId: workspace.id, data: { name: newName } }),
          'Workspace renamed',
          'Failed to rename workspace',
        );
      } catch {
        // toast already shown by mutateWithToast
      } finally {
        setWorkspaceToRename(null);
      }
    },
    [workspaceToRename, updateWorkspace, cloudUpdateWorkspace],
  );

  const handleDeleteWorkspace = useCallback((workspaceId: string, isCloud: boolean) => {
    setWorkspaceToDelete({ id: workspaceId, isCloud });
    setWorkspaceDropdown(null);
  }, []);

  const confirmDeleteWorkspace = useCallback(async () => {
    if (!workspaceToDelete) return;
    const { id, isCloud } = workspaceToDelete;
    const mutation = isCloud ? cloudDeleteWorkspace : deleteWorkspace;
    try {
      await mutateWithToast(
        () => mutation.mutateAsync(id),
        'Workspace deleted',
        'Failed to delete workspace',
      );
      if (selectedChatId && selectedChatWorkspaceId === id) {
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
    cloudDeleteWorkspace,
    selectedChatId,
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
    cloudUpdateWorkspace,
    handleNewWorkspaceThread,
    handleNewCloudThread,
    handleWorkspaceContextMenu,
    handleRenameWorkspace,
    handleSaveWorkspaceRename,
    handleDeleteWorkspace,
    confirmDeleteWorkspace,
  };
}

export type SidebarWorkspaceActions = ReturnType<typeof useSidebarWorkspaceActions>;
