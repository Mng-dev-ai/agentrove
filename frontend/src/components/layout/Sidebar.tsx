import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Chat } from '@/types/chat.types';
import type { Workspace } from '@/types/workspace.types';
import { Button } from '@/components/ui/primitives/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RenameModal } from '@/components/ui/RenameModal';
import {
  useDeleteChatMutation,
  useGenerateChatTitleMutation,
  useUpdateChatMutation,
  usePinChatMutation,
  useInfiniteChatsQuery,
} from '@/hooks/queries/useChatQueries';
import {
  useDeleteWorkspaceMutation,
  useUpdateWorkspaceMutation,
} from '@/hooks/queries/useWorkspaceQueries';
import {
  useCloudWorkspacesQuery,
  useCloudUpdateWorkspaceMutation,
  useCloudDeleteWorkspaceMutation,
} from '@/hooks/queries/useCloudQueries';
import { useToggleSet } from '@/hooks/useToggleSet';
import { cn } from '@/utils/cn';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { useStreamStore } from '@/store/streamStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useCurrentUserQuery, useLogoutMutation } from '@/hooks/queries/useAuthQueries';
import { useAuthStore } from '@/store/authStore';
import { UserProfileMenu } from './UserProfileMenu';
import { SidebarChatItem } from './SidebarChatItem';
import { SidebarResizeHandle } from './SidebarResizeHandle';
import { SubThreadList } from './SubThreadList';
import { SidebarWorkspaceGroup, SidebarCloudGroup } from './SidebarChatGroup';
import { ChatDropdown } from './ChatDropdown';
import { DROPDOWN_WIDTH, DROPDOWN_HEIGHT, DROPDOWN_MARGIN } from '@/config/constants';

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
  const logoutMutation = useLogoutMutation({
    onSuccess: () => {
      useAuthStore.getState().setAuthenticated(false);
      navigate('/login');
    },
  });
  const activeStreamMetadata = useStreamStore((state) => state.activeStreamMetadata);
  const secondaryChatId = useUIStore((state) => state.secondaryChatId);
  const streamingChatIdSet = useMemo(
    () => new Set(activeStreamMetadata.map((meta) => meta.chatId)),
    [activeStreamMetadata],
  );
  const [collapsedWorkspaces, toggleWorkspaceCollapse, setCollapsedWorkspaces] =
    useToggleSet<string>();
  const [pinnedHoveredId, setPinnedHoveredId] = useState<string | null>(null);
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

  const { data: pinnedChatsData } = useInfiniteChatsQuery({ pinned: true });
  const pinnedChats = useMemo(() => {
    if (!pinnedChatsData?.pages) return [];
    return pinnedChatsData.pages.flatMap((page) => page.items);
  }, [pinnedChatsData?.pages]);

  // Cloud projects (workspaces on the connected VPS, desktop only). Each renders
  // its own paginated group, mirroring the local per-workspace groups.
  const { data: cloudWorkspaces } = useCloudWorkspacesQuery(true);
  const orderedWorkspaces = useMemo(
    () =>
      [
        ...workspaces.map((workspace) => ({ workspace, isCloud: false })),
        ...(cloudWorkspaces ?? []).map((workspace) => ({ workspace, isCloud: true })),
      ].sort((a, b) => {
        // Local and cloud lists are fetched separately; merge by activity so a
        // fresh cloud chat can move its project above stale local projects.
        const aTime = Date.parse(a.workspace.last_chat_at ?? a.workspace.updated_at);
        const bTime = Date.parse(b.workspace.last_chat_at ?? b.workspace.updated_at);
        return bTime - aTime;
      }),
    [workspaces, cloudWorkspaces],
  );

  // Distinguishes cloud vs local when the context menu opens, so rename/delete
  // route to the right backend. Workspace IDs are UUIDs from separate DBs — no collisions.
  const cloudWorkspaceIdSet = useMemo(
    () => new Set((cloudWorkspaces ?? []).map((ws) => ws.id)),
    [cloudWorkspaces],
  );

  const hasAnyContent =
    pinnedChats.length > 0 || workspaces.length > 0 || (cloudWorkspaces?.length ?? 0) > 0;

  useEffect(() => {
    if (!selectedChatWorkspaceId) return;
    setCollapsedWorkspaces((prev) => {
      if (!prev.has(selectedChatWorkspaceId)) return prev;
      const next = new Set(prev);
      next.delete(selectedChatWorkspaceId);
      return next;
    });
  }, [selectedChatWorkspaceId, setCollapsedWorkspaces]);

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
      setPinnedHoveredId(null);
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
      setPinnedHoveredId(null);
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

  const handlePinnedMouseEnter = useCallback((chatId: string) => {
    setPinnedHoveredId(chatId);
  }, []);

  const handlePinnedMouseLeave = useCallback(() => {
    setPinnedHoveredId(null);
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

  const handleDropdownClick = useCallback((e: React.MouseEvent<HTMLButtonElement>, chat: Chat) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();

    setPinnedHoveredId(null);

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
      const isCloud = cloudWorkspaceIdSet.has(workspaceId);
      setWorkspaceDropdown((prev) => {
        if (prev?.workspaceId === workspaceId) return null;
        const position = calculateDropdownPosition(rect);
        return { workspaceId, isCloud, position };
      });
    },
    [cloudWorkspaceIdSet],
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

  // Props every workspace group needs identically — local and cloud differ only in
  // the namespaced key and the local-only header actions (new thread, context menu).
  const sharedGroupProps = {
    selectedChatId,
    secondaryChatId,
    dropdownChatId: dropdown?.chat.id ?? null,
    streamingChatIdSet,
    onToggleCollapse: toggleWorkspaceCollapse,
    onChatSelect: handleChatSelect,
    onOpenInSplit: canOpenInSplit ? handleOpenInSplit : undefined,
    onDropdownClick: handleDropdownClick,
    expandedSubThreads,
    onToggleSubThreads: handleToggleSubThreads,
  };

  return (
    <>
      <aside
        aria-label="Chat history"
        className={cn(
          'absolute left-0 top-0 h-full w-[var(--sidebar-width)]',
          'border-r border-border/50 bg-surface-secondary dark:border-border-dark/50 dark:bg-surface-dark-secondary',
          'z-40 flex flex-col transition-[transform,width] duration-[var(--sidebar-transition-duration,500ms)] ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="px-4 pt-2">
          <Button
            onClick={handleNewChat}
            variant="unstyled"
            className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-surface-tertiary px-2 py-2 text-[13px] font-medium text-text-secondary transition-colors duration-200 hover:bg-surface-tertiary hover:text-text-primary dark:bg-surface-dark-tertiary/50 dark:text-text-dark-secondary dark:hover:bg-surface-dark-tertiary dark:hover:text-text-dark-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            New thread
          </Button>
        </div>

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-6">
          {!hasAnyContent ? (
            <p className="py-8 text-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
              No chats yet
            </p>
          ) : (
            <div>
              {pinnedChats.length > 0 && (
                <div className="mb-1">
                  <div className="pb-2 pt-2.5">
                    <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                      Pinned
                    </span>
                  </div>
                  <div>
                    {pinnedChats.map((chat) => (
                      <div key={chat.id}>
                        <SidebarChatItem
                          chat={chat}
                          isSelected={chat.id === selectedChatId}
                          isActive={chat.id === selectedChatId || chat.id === secondaryChatId}
                          isHovered={pinnedHoveredId === chat.id}
                          isDropdownOpen={dropdown?.chat.id === chat.id}
                          isChatStreaming={streamingChatIdSet.has(chat.id)}
                          onSelect={handleChatSelect}
                          onOpenInSplit={canOpenInSplit ? handleOpenInSplit : undefined}
                          onDropdownClick={handleDropdownClick}
                          onMouseEnter={handlePinnedMouseEnter}
                          onMouseLeave={handlePinnedMouseLeave}
                          onToggleSubThreads={
                            chat.sub_thread_count > 0 ? handleToggleSubThreads : undefined
                          }
                          isSubThreadsExpanded={
                            chat.sub_thread_count > 0 ? expandedSubThreads.has(chat.id) : undefined
                          }
                        />
                        {chat.sub_thread_count > 0 && expandedSubThreads.has(chat.id) && (
                          <SubThreadList
                            parentChatId={chat.id}
                            selectedChatId={selectedChatId}
                            secondaryChatId={secondaryChatId}
                            onSelect={handleChatSelect}
                            onDropdownClick={handleDropdownClick}
                            streamingChatIdSet={streamingChatIdSet}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {orderedWorkspaces.map(({ workspace, isCloud }) =>
                isCloud ? (
                  <SidebarCloudGroup
                    key={`cloud:${workspace.id}`}
                    workspace={workspace}
                    isCollapsed={collapsedWorkspaces.has(workspace.id)}
                    onNewThread={handleNewCloudThread}
                    onWorkspaceContextMenu={handleWorkspaceContextMenu}
                    {...sharedGroupProps}
                  />
                ) : (
                  <SidebarWorkspaceGroup
                    key={`local:${workspace.id}`}
                    workspace={workspace}
                    isCollapsed={collapsedWorkspaces.has(workspace.id)}
                    onNewThread={handleNewWorkspaceThread}
                    onWorkspaceContextMenu={handleWorkspaceContextMenu}
                    {...sharedGroupProps}
                  />
                ),
              )}
            </div>
          )}
        </div>

        {/* User profile — fixed at sidebar bottom; always rendered so settings/logout are accessible even if the user query is loading or failed */}
        <div className="flex-shrink-0 border-t border-border/50 px-4 py-2.5 dark:border-border-dark/50">
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
        <div
          ref={workspaceDropdownRef}
          className="fixed z-50 w-40 rounded-xl border border-border/50 bg-surface-secondary p-1 shadow-medium backdrop-blur-xl dark:border-border-dark/50 dark:bg-surface-dark-secondary"
          style={{
            top: workspaceDropdown.position.top,
            left: workspaceDropdown.position.left,
          }}
        >
          <Button
            variant="unstyled"
            type="button"
            onClick={() => {
              const list = workspaceDropdown.isCloud ? (cloudWorkspaces ?? []) : workspaces;
              const ws = list.find((w) => w.id === workspaceDropdown.workspaceId);
              if (ws) handleRenameWorkspace(ws, workspaceDropdown.isCloud);
            }}
            className="w-full rounded-md px-2.5 py-1.5 text-left text-xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover"
          >
            Rename
          </Button>
          <Button
            variant="unstyled"
            type="button"
            onClick={() =>
              handleDeleteWorkspace(workspaceDropdown.workspaceId, workspaceDropdown.isCloud)
            }
            className="w-full rounded-md px-2.5 py-1.5 text-left text-xs text-error-500 transition-colors duration-200 hover:bg-surface-hover dark:text-error-400 dark:hover:bg-surface-dark-hover"
          >
            Delete
          </Button>
        </div>
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
