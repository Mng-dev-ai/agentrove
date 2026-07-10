import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import type { Chat } from '@/types/chat.types';
import type { Workspace } from '@/types/workspace.types';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog/ConfirmDialog';
import { RenameModal } from '@/components/ui/RenameModal/RenameModal';
import {
  useDeleteChatMutation,
  useGenerateChatTitleMutation,
  useUpdateChatMutation,
  usePinChatMutation,
} from '@/hooks/queries/useChatQueries';
import {
  useDeleteWorkspaceMutation,
  useUpdateWorkspaceMutation,
} from '@/hooks/queries/useWorkspaceQueries';
import {
  useCloudUpdateWorkspaceMutation,
  useCloudDeleteWorkspaceMutation,
} from '@/hooks/queries/useCloudQueries';
import { useSidebarChatLists } from '@/hooks/queries/useSidebarChatLists';
import { useToggleSet } from '@/hooks/useToggleSet';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { useStreamStore } from '@/store/streamStore';
import { usePermissionStore } from '@/store/permissionStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useCurrentUserQuery } from '@/hooks/queries/useAuthQueries';
import { useAuthStore } from '@/store/authStore';
import { useLogout } from '@/hooks/useLogout';
import { UserProfileMenu } from '@/components/layout/UserProfileMenu/UserProfileMenu';
import { SidebarResizeHandle } from './SidebarResizeHandle';
import { SidebarActions } from './SidebarActions';
import { SidebarChatList } from './SidebarChatList';
import { WorkspaceContextMenu } from './WorkspaceContextMenu';
import { type ChatRowProps } from './SidebarChatRow';
import { buildRecentChatSections } from './sidebarGrouping';
import { countActiveSidebarFilters } from '@/store/sidebarFilters';
import { isCloudChat } from '@/utils/chatOrigin';
import { ChatDropdown } from './ChatDropdown';
import { DROPDOWN_WIDTH, DROPDOWN_HEIGHT, DROPDOWN_MARGIN } from '@/config/constants';
import styles from './Sidebar.module.scss';

async function mutateWithToast<T>(
  mutateFn: () => Promise<T>,
  successMessage: string,
  failureMessage: string,
): Promise<T> {
  try {
    const result = await mutateFn();
    toast.success(successMessage);
    return result;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : failureMessage);
    throw error;
  }
}

function calculateDropdownPosition(buttonRect: DOMRect): { top: number; left: number } {
  const isMobile = window.innerWidth < 640;
  const spaceBelow = window.innerHeight - buttonRect.bottom;
  const spaceRight = window.innerWidth - buttonRect.right;

  let top: number;
  let left: number;

  if (isMobile) {
    top =
      spaceBelow >= DROPDOWN_HEIGHT + DROPDOWN_MARGIN
        ? buttonRect.bottom + 4
        : buttonRect.top - DROPDOWN_HEIGHT - 4;
    left = buttonRect.right - DROPDOWN_WIDTH;
  } else {
    top =
      spaceBelow >= DROPDOWN_HEIGHT + DROPDOWN_MARGIN
        ? buttonRect.top
        : buttonRect.top - DROPDOWN_HEIGHT + buttonRect.height;
    left =
      spaceRight >= DROPDOWN_WIDTH + DROPDOWN_MARGIN
        ? buttonRect.right + 4
        : buttonRect.left - DROPDOWN_WIDTH - 4;
  }

  top = Math.max(
    DROPDOWN_MARGIN,
    Math.min(top, window.innerHeight - DROPDOWN_HEIGHT - DROPDOWN_MARGIN),
  );
  left = Math.max(
    DROPDOWN_MARGIN,
    Math.min(left, window.innerWidth - DROPDOWN_WIDTH - DROPDOWN_MARGIN),
  );

  return { top, left };
}

export interface SidebarProps {
  workspaces: Workspace[];
  selectedChatId: string | null;
  selectedChatWorkspaceId?: string | null;
  selectedChatParentId?: string | null;
  onChatSelect: (chatId: string) => void;
  onDeleteChat?: (chatId: string) => void;
}

export function Sidebar({
  workspaces,
  selectedChatId,
  selectedChatWorkspaceId,
  selectedChatParentId,
  onChatSelect,
  onDeleteChat,
}: SidebarProps) {
  const navigate = useNavigate();
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const isMobile = useIsMobile();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: currentUser } = useCurrentUserQuery({ enabled: isAuthenticated });
  const userDisplayName = currentUser?.username || currentUser?.email || '';
  const logoutMutation = useLogout();
  const activeStreamMetadata = useStreamStore((state) => state.activeStreamMetadata);
  // Chats whose stream finished successfully since last viewed — drives the "Done" badge
  const completedChatIds = useStreamStore((state) => state.completedChatIds);
  const secondaryChatId = useUIStore((state) => state.secondaryChatId);
  const streamingChatIdSet = useMemo(
    () => new Set(activeStreamMetadata.map((meta) => meta.chatId)),
    [activeStreamMetadata],
  );
  // Chats with a pending plan/question/permission request — the agent is
  // blocked on the user. Empty queues are deleted from the store, so every
  // remaining key has an outstanding request.
  const pendingRequests = usePermissionStore((state) => state.pendingRequests);
  const blockedChatIdSet = useMemo(() => new Set(pendingRequests.keys()), [pendingRequests]);
  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null);
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);
  const [chatToRename, setChatToRename] = useState<Chat | null>(null);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<{
    id: string;
    isCloud: boolean;
  } | null>(null);
  const [workspaceToRename, setWorkspaceToRename] = useState<{
    workspace: Workspace;
    isCloud: boolean;
  } | null>(null);
  const [dropdown, setDropdown] = useState<{
    chat: Chat;
    position: { top: number; left: number };
  } | null>(null);
  const [workspaceDropdown, setWorkspaceDropdown] = useState<{
    workspaceId: string;
    isCloud: boolean;
    position: { top: number; left: number };
  } | null>(null);
  // Tracks which parent chats have their sub-threads expanded — collapsed by default to keep the sidebar compact
  const [expandedSubThreads, toggleSubThreadExpand, setExpandedSubThreads] = useToggleSet<string>();
  // Chats merge from two backends, so filters apply client-side over loaded
  // pages. Lives in the persisted uiStore so reloads keep the narrowed view.
  const filters = useUIStore((state) => state.sidebarFilters);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const workspaceDropdownRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const deleteChat = useDeleteChatMutation();
  const updateChat = useUpdateChatMutation();
  const generateChatTitle = useGenerateChatTitleMutation();
  const pinChat = usePinChatMutation();
  const deleteWorkspace = useDeleteWorkspaceMutation();
  const updateWorkspace = useUpdateWorkspaceMutation();
  const cloudUpdateWorkspace = useCloudUpdateWorkspaceMutation();
  const cloudDeleteWorkspace = useCloudDeleteWorkspaceMutation();

  const {
    pinnedChats,
    recentChats,
    workspaceBadgeById,
    cloudWorkspaces,
    isLoadingChats,
    hasMore,
    isFetchingMore,
    loadMore,
  } = useSidebarChatLists(workspaces);

  const hasAnyContent = pinnedChats.length > 0 || recentChats.length > 0;

  const hasActiveFilters = countActiveSidebarFilters(filters) > 0;
  // Status filters OR together (any selected badge state matches); source and
  // workspace AND with them. Cloud-ness comes from chatOrigin (marked at fetch
  // time, hydrated at module load) — the workspace badge map lags behind the
  // cloud workspaces query and would misclassify cloud chats as local meanwhile.
  const chatMatchesFilters = useCallback(
    (chat: Chat) => {
      if (filters.workspaceId && chat.workspace_id !== filters.workspaceId) return false;
      if (filters.agentKind && chat.session_agent_kind !== filters.agentKind) return false;
      if (filters.source !== 'all' && isCloudChat(chat.id) !== (filters.source === 'cloud')) {
        return false;
      }
      if (filters.statuses.length === 0) return true;
      return (
        (filters.statuses.includes('unread') && chat.unread) ||
        (filters.statuses.includes('running') && streamingChatIdSet.has(chat.id)) ||
        (filters.statuses.includes('done') && completedChatIds.has(chat.id)) ||
        (filters.statuses.includes('needs-you') && blockedChatIdSet.has(chat.id))
      );
    },
    [filters, streamingChatIdSet, completedChatIds, blockedChatIdSet],
  );
  const visiblePinnedChats = useMemo(
    () => (hasActiveFilters ? pinnedChats.filter(chatMatchesFilters) : pinnedChats),
    [hasActiveFilters, pinnedChats, chatMatchesFilters],
  );
  const visibleRecentChats = useMemo(
    () => (hasActiveFilters ? recentChats.filter(chatMatchesFilters) : recentChats),
    [hasActiveFilters, recentChats, chatMatchesFilters],
  );
  const hasVisibleContent = visiblePinnedChats.length > 0 || visibleRecentChats.length > 0;

  const groupBy = filters.groupBy;
  const recentChatSections = useMemo(
    () =>
      buildRecentChatSections({
        groupBy,
        visibleRecentChats,
        workspaceBadgeById,
        blockedChatIdSet,
        streamingChatIdSet,
        completedChatIds,
      }),
    [
      groupBy,
      visibleRecentChats,
      workspaceBadgeById,
      blockedChatIdSet,
      streamingChatIdSet,
      completedChatIds,
    ],
  );

  // Opening a chat (or watching it finish while open) counts as seeing the
  // completion — clear its Done badge. Covers every open path since both ids
  // are route/layout-derived, not sidebar-click-derived.
  useEffect(() => {
    const store = useStreamStore.getState();
    if (selectedChatId && completedChatIds.has(selectedChatId)) {
      store.clearCompleted(selectedChatId);
    }
    if (secondaryChatId && completedChatIds.has(secondaryChatId)) {
      store.clearCompleted(secondaryChatId);
    }
  }, [selectedChatId, secondaryChatId, completedChatIds]);

  // Auto-expand parent when navigating to a sub-thread from outside the sidebar
  useEffect(() => {
    if (!selectedChatParentId) return;
    setExpandedSubThreads((prev) => {
      if (prev.has(selectedChatParentId)) return prev;
      const next = new Set(prev);
      next.add(selectedChatParentId);
      return next;
    });
  }, [selectedChatParentId, setExpandedSubThreads]);

  useMountEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdown(null);
      }
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

  const dropdownStateRef = useRef(dropdown);
  dropdownStateRef.current = dropdown;
  const wsDropdownStateRef = useRef(workspaceDropdown);
  wsDropdownStateRef.current = workspaceDropdown;

  useMountEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      if (dropdownStateRef.current) setDropdown(null);
      if (wsDropdownStateRef.current) setWorkspaceDropdown(null);
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  });

  // Clears any open dropdown when collapsing sub-threads, since the dropdown
  // target may become hidden
  const handleToggleSubThreads = useCallback(
    (chatId: string) => {
      toggleSubThreadExpand(chatId);
      if (dropdownStateRef.current) setDropdown(null);
    },
    [toggleSubThreadExpand],
  );

  const handleChatSelect = useCallback(
    (chatId: string) => {
      onChatSelect(chatId);
      setHoveredChatId(null);
      if (isMobile) {
        useUIStore.getState().setSidebarOpen(false);
      }
    },
    [onChatSelect, isMobile],
  );

  const handleOpenInSplit = useCallback(
    (chatId: string) => {
      if (isMobile || !selectedChatId) {
        onChatSelect(chatId);
        return;
      }
      useUIStore.getState().openChatInSplit(chatId);
      setHoveredChatId(null);
    },
    [isMobile, onChatSelect, selectedChatId],
  );

  const handleDropdownOpenInSplit = useCallback(
    (chatId: string) => {
      handleOpenInSplit(chatId);
      setDropdown(null);
    },
    [handleOpenInSplit],
  );
  const canOpenInSplit = !isMobile && selectedChatId != null;
  const dropdownCanSplit = canOpenInSplit && dropdown?.chat.id !== selectedChatId;

  const handleDeleteChat = useCallback((chatId: string) => {
    setChatToDelete(chatId);
    setDropdown(null);
  }, []);

  const handleChatMouseEnter = useCallback((chatId: string) => {
    setHoveredChatId(chatId);
  }, []);

  const handleChatMouseLeave = useCallback(() => {
    setHoveredChatId(null);
  }, []);

  const confirmDeleteChat = useCallback(async () => {
    if (!chatToDelete) return;
    try {
      await mutateWithToast(
        () => deleteChat.mutateAsync(chatToDelete),
        'Chat deleted successfully',
        'Failed to delete chat',
      );
      const uiState = useUIStore.getState();
      if (chatToDelete === selectedChatId || uiState.secondaryChatId === chatToDelete) {
        uiState.closeSplitChat();
      }
      if (chatToDelete === selectedChatId || chatToDelete === selectedChatParentId) {
        navigate('/');
      }
      // Release any pending File blobs held for this chat.
      useChatStore.getState().clearAttachedFilesForChat(chatToDelete);
      onDeleteChat?.(chatToDelete);
    } catch {
      // toast already shown by mutateWithToast
    } finally {
      setChatToDelete(null);
    }
  }, [chatToDelete, deleteChat, selectedChatId, selectedChatParentId, navigate, onDeleteChat]);

  const handleNewChat = useCallback(() => {
    navigate('/');
    if (isMobile) {
      useUIStore.getState().setSidebarOpen(false);
    }
  }, [navigate, isMobile]);

  const handleOpenSearch = useCallback(() => {
    useUIStore.getState().setCommandMenuOpen(true);
    // Close the drawer on mobile so the destination isn't hidden behind it after picking a result
    if (isMobile) {
      useUIStore.getState().setSidebarOpen(false);
    }
  }, [isMobile]);

  const handleDropdownClick = useCallback((e: React.MouseEvent<HTMLButtonElement>, chat: Chat) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();

    setHoveredChatId(null);

    setDropdown((prev) => {
      if (prev?.chat.id === chat.id) {
        return null;
      }

      const position = calculateDropdownPosition(rect);
      return { chat, position };
    });
  }, []);

  const handleRenameClick = useCallback((chat: Chat) => {
    setChatToRename(chat);
    setDropdown(null);
  }, []);

  const handleSaveRename = useCallback(
    async (newTitle: string) => {
      if (!chatToRename) return;
      try {
        await mutateWithToast(
          () =>
            updateChat.mutateAsync({ chatId: chatToRename.id, updateData: { title: newTitle } }),
          'Chat renamed successfully',
          'Failed to rename chat',
        );
      } catch {
        // toast already shown by mutateWithToast
      } finally {
        setChatToRename(null);
      }
    },
    [chatToRename, updateChat],
  );

  const handleGenerateChatTitle = useCallback(async () => {
    if (!chatToRename) return '';
    try {
      return await generateChatTitle.mutateAsync(chatToRename.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to generate title');
      return '';
    }
  }, [chatToRename, generateChatTitle]);

  const handleTogglePin = useCallback(
    async (chat: Chat) => {
      setDropdown(null);
      const isPinned = !!chat.pinned_at;
      try {
        await mutateWithToast(
          () => pinChat.mutateAsync({ chatId: chat.id, pinned: !isPinned }),
          isPinned ? 'Chat unpinned' : 'Chat pinned',
          'Failed to update pin status',
        );
      } catch {
        // toast already shown by mutateWithToast
      }
    },
    [pinChat],
  );

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

  const rowProps: ChatRowProps = {
    selectedChatId,
    secondaryChatId,
    hoveredChatId,
    dropdownChatId: dropdown?.chat.id ?? null,
    streamingChatIdSet,
    blockedChatIdSet,
    completedChatIdSet: completedChatIds,
    workspaceBadgeById,
    onChatSelect: handleChatSelect,
    onOpenInSplit: canOpenInSplit ? handleOpenInSplit : undefined,
    onDropdownClick: handleDropdownClick,
    onWorkspaceBadgeClick: handleWorkspaceContextMenu,
    onMouseEnter: handleChatMouseEnter,
    onMouseLeave: handleChatMouseLeave,
    expandedSubThreads,
    onToggleSubThreads: handleToggleSubThreads,
  };

  return (
    <>
      <aside
        aria-label="Chat history"
        className={clsx(styles.sidebar, sidebarOpen && styles['sidebar--open'])}
      >
        <SidebarActions onNewChat={handleNewChat} onOpenSearch={handleOpenSearch} />

        <SidebarChatList
          scrollContainerRef={scrollContainerRef}
          isLoadingChats={isLoadingChats}
          hasAnyContent={hasAnyContent}
          visiblePinnedChats={visiblePinnedChats}
          visibleRecentChats={visibleRecentChats}
          hasVisibleContent={hasVisibleContent}
          recentChatSections={recentChatSections}
          rowProps={rowProps}
          filters={filters}
          onChangeFilters={(next) => useUIStore.getState().setSidebarFilters(next)}
          workspaceBadgeById={workspaceBadgeById}
          hasMore={hasMore}
          isFetchingMore={isFetchingMore}
          onLoadMore={loadMore}
        />

        {/* User profile — fixed at sidebar bottom; always rendered so settings/logout are accessible even if the user query is loading or failed */}
        <div className={styles.footer}>
          <UserProfileMenu
            displayName={userDisplayName}
            onOpenSettings={() => navigate('/settings')}
            onSignOut={() => logoutMutation.mutate()}
          />
        </div>
        {!isMobile && <SidebarResizeHandle />}
      </aside>

      {dropdown && (
        <ChatDropdown
          ref={dropdownRef}
          chat={dropdown.chat}
          position={dropdown.position}
          onRename={handleRenameClick}
          onDelete={handleDeleteChat}
          onTogglePin={handleTogglePin}
          onOpenInSplit={dropdownCanSplit ? handleDropdownOpenInSplit : undefined}
          onClose={() => setDropdown(null)}
        />
      )}

      {workspaceDropdown && (
        <WorkspaceContextMenu
          ref={workspaceDropdownRef}
          position={workspaceDropdown.position}
          onNewThread={(e) => {
            const { workspaceId, isCloud } = workspaceDropdown;
            setWorkspaceDropdown(null);
            (isCloud ? handleNewCloudThread : handleNewWorkspaceThread)(e, workspaceId);
          }}
          onRename={() => {
            const list = workspaceDropdown.isCloud ? (cloudWorkspaces ?? []) : workspaces;
            const ws = list.find((w) => w.id === workspaceDropdown.workspaceId);
            if (ws) handleRenameWorkspace(ws, workspaceDropdown.isCloud);
          }}
          onDelete={() =>
            handleDeleteWorkspace(workspaceDropdown.workspaceId, workspaceDropdown.isCloud)
          }
        />
      )}

      <ConfirmDialog
        isOpen={!!chatToDelete}
        onClose={() => setChatToDelete(null)}
        onConfirm={confirmDeleteChat}
        title="Delete Chat"
        message="Are you sure you want to delete this chat? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      <ConfirmDialog
        isOpen={!!workspaceToDelete}
        onClose={() => setWorkspaceToDelete(null)}
        onConfirm={confirmDeleteWorkspace}
        title="Delete Workspace"
        message="Are you sure you want to delete this workspace and all its chats? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      <RenameModal
        isOpen={!!chatToRename}
        onClose={() => setChatToRename(null)}
        onSave={handleSaveRename}
        currentTitle={chatToRename?.title || ''}
        isLoading={updateChat.isPending}
        onGenerateTitle={handleGenerateChatTitle}
        isGenerating={generateChatTitle.isPending}
      />

      <RenameModal
        isOpen={!!workspaceToRename}
        onClose={() => setWorkspaceToRename(null)}
        onSave={handleSaveWorkspaceRename}
        currentTitle={workspaceToRename?.workspace.name || ''}
        isLoading={updateWorkspace.isPending || cloudUpdateWorkspace.isPending}
      />
    </>
  );
}
