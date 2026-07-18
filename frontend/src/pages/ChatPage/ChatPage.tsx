import { useEffect, useMemo, useCallback, useRef, ReactNode, Suspense } from 'react';
import { lazyNamed } from '@/utils/lazyNamed';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar/Sidebar';
import { useLayoutSidebar } from '@/components/layout/Layout/layoutState';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { SplitViewContainer } from '@/components/ui/SplitViewContainer/SplitViewContainer';
import { CommandMenu } from '@/components/ui/command-menu/CommandMenu';
import { useCommandMenu } from '@/hooks/useCommandMenu';
import { useActiveViews } from '@/hooks/useActiveViews';
import { viewLoadingFallback } from '@/components/ui/shared/ViewLoadingFallback/ViewLoadingFallback';
import type { TileId, ViewType } from '@/types/ui.types';
import { splitSlotOfTile, tileIdToViewType } from '@/utils/tileHelpers';
import { Chat as ChatComponent } from '@/components/chat/chat-window/Chat';
import { ChatSessionOrchestrator } from '@/components/chat/chat-window/ChatSessionOrchestrator';
import { AgentPane } from '@/components/chat/chat-window/AgentPane';
import { useChatData } from '@/hooks/useChatData';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useQueryClient } from '@tanstack/react-query';
import { useChatQuery, markChatViewed } from '@/hooks/queries/useChatQueries';
import { useSandboxFiles } from '@/hooks/useSandboxFiles';
import { useWorkspacesList, useWorkspaceResourcesQuery } from '@/hooks/queries/useWorkspaceQueries';
import { useSettingsForChatQuery } from '@/hooks/queries/useSettingsQueries';
import { ChatProvider } from '@/contexts/ChatContext';
import { SubThreadDialog } from './SubThreadDialog';
import styles from './ChatPage.module.scss';

const EditorPane = lazyNamed(
  () => import('@/components/editor/editor-core/EditorPane'),
  'EditorPane',
);
const DiffView = lazyNamed(() => import('@/components/sandbox/git/DiffView/DiffView'), 'DiffView');
const TerminalContainer = lazyNamed(
  () => import('@/components/sandbox/terminal/Container/Container'),
  'Container',
);
const CreateBranchDialog = lazyNamed(
  () => import('@/components/chat/github/CreateBranchDialog'),
  'CreateBranchDialog',
);
const CreateCommitDialog = lazyNamed(
  () => import('@/components/chat/github/CreateCommitDialog'),
  'CreateCommitDialog',
);
const CreatePRDialog = lazyNamed(
  () => import('@/components/chat/github/CreatePRDialog'),
  'CreatePRDialog',
);

export function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  useCommandMenu();
  const subThreadDialogOpen = useUIStore((s) => s.subThreadDialogOpen);
  const createCommitDialogOpen = useUIStore((s) => s.createCommitDialogOpen);
  const createPRDialogOpen = useUIStore((s) => s.createPRDialogOpen);
  const createBranchDialogOpen = useUIStore((s) => s.createBranchDialogOpen);

  const activeViews = useActiveViews();
  const splitChatIds = useUIStore((s) => s.splitChatIds);
  const isMobile = useIsMobile();

  const { currentChat, fetchedMessages, hasFetchedMessages, messagesQuery } = useChatData(chatId);

  // These share AgentPane's chat-query cache and provide each split pane's
  // sandbox/worktree metadata plus deletion error guards.
  const splitQuery1 = useChatQuery(splitChatIds[0], {
    enabled: !!splitChatIds[0],
  });
  const splitQuery2 = useChatQuery(splitChatIds[1], {
    enabled: !!splitChatIds[1],
  });
  const splitQuery3 = useChatQuery(splitChatIds[2], {
    enabled: !!splitChatIds[2],
  });
  useEffect(() => {
    if (splitChatIds[0] && splitQuery1.isError) {
      useUIStore.getState().closeSplitChat(splitChatIds[0]);
    } else if (splitChatIds[1] && splitQuery2.isError) {
      useUIStore.getState().closeSplitChat(splitChatIds[1]);
    } else if (splitChatIds[2] && splitQuery3.isError) {
      useUIStore.getState().closeSplitChat(splitChatIds[2]);
    }
  }, [splitChatIds, splitQuery1.isError, splitQuery2.isError, splitQuery3.isError]);

  // Each chat keeps its own tabs: restore them on entry, stash them on leave.
  // Must run before the split-rebuild effect below — on mount it restores the
  // primary-only layout, and the split-rebuild then reapplies a persisted
  // split layout on top. Reversed, the restore would wipe the rebuilt split.
  useMountEffect(() => {
    if (chatId) useUIStore.getState().loadWorkspaceForChat(chatId);
    return () => useUIStore.getState().stashWorkspace();
  });

  // A chat switch can restore a primary-only stash while split ids remain bound.
  // Rebuild only when an agent tile is missing so normal compaction and user-
  // activated full-screen views keep their layout and focus.
  useEffect(() => {
    if (chatId && splitChatIds.includes(chatId)) {
      useUIStore.getState().closeSplitChat(chatId);
      return;
    }
    if (!isMobile && splitChatIds.length > 0) {
      const ui = useUIStore.getState();
      const expectedAgentTiles = ['agent:split-1', 'agent:split-2', 'agent:split-3'] as const;
      const isAgentTileMissing = splitChatIds.some(
        (_, index) => !ui.openTabs.includes(expectedAgentTiles[index]),
      );
      if (isAgentTileMissing) ui.rebuildSplitLayout();
    }
  }, [chatId, isMobile, splitChatIds]);

  const queryClient = useQueryClient();
  // Opening a chat in either pane marks it seen — stamps last_viewed_at
  // server-side and drops the sidebar unread dot.
  useEffect(() => {
    if (chatId) void markChatViewed(queryClient, chatId);
  }, [chatId, queryClient]);
  useEffect(() => {
    // On mobile the split isn't rebuilt, so split chats are off-screen even
    // though the store still holds their ids — don't stamp them as seen.
    // Returning to desktop re-runs this and stamps as the pane reappears.
    if (!isMobile) {
      for (const splitChatId of splitChatIds) void markChatViewed(queryClient, splitChatId);
    }
  }, [splitChatIds, isMobile, queryClient]);

  const { fileStructure, refetchFilesMetadata } = useSandboxFiles(currentChat, chatId);

  const worktreeCwd = currentChat?.worktree_cwd ?? undefined;

  const prevViewsRef = useRef<{
    views: ViewType[];
    sandboxId: string | null;
  }>({
    views: [],
    sandboxId: null,
  });

  useEffect(() => {
    if (!currentChat?.sandbox_id) return;

    const prev = prevViewsRef.current;
    const editorNowActive = activeViews.includes('editor');
    const editorWasActive = prev.views.includes('editor');
    const switchedSandbox = prev.sandboxId !== currentChat.sandbox_id;

    if ((editorNowActive && !editorWasActive) || (editorNowActive && switchedSandbox)) {
      refetchFilesMetadata();
    }

    prevViewsRef.current = {
      views: activeViews,
      sandboxId: currentChat.sandbox_id,
    };
  }, [activeViews, currentChat?.sandbox_id, refetchFilesMetadata]);

  const workspaces = useWorkspacesList();
  // Routes to the instance that owns the chat so a cloud chat's persona selector
  // shows the VPS's personas (and sends resolve the selected name against them).
  const { data: settings } = useSettingsForChatQuery(chatId);

  const { data: workspaceResources } = useWorkspaceResourcesQuery(
    currentChat?.workspace_id,
    chatId,
  );

  const prevChatIdForResetRef = useRef(chatId);

  useEffect(() => {
    useChatStore.getState().setCurrentChat(currentChat || null);
  }, [currentChat]);

  if (prevChatIdForResetRef.current !== chatId) {
    prevChatIdForResetRef.current = chatId;
    const ui = useUIStore.getState();
    // Restore the chat's own saved tabs (stashing the outgoing chat's first).
    if (chatId) ui.loadWorkspaceForChat(chatId);
    // Switching into a chat that's currently in a split pane closes that pane.
    if (chatId && ui.splitChatIds.includes(chatId)) {
      ui.closeSplitChat(chatId);
    }
    useUIStore.setState({
      pendingFileOpen: null,
      subThreadDialogOpen: false,
      createCommitDialogOpen: false,
      createPRDialogOpen: false,
      createBranchDialogOpen: false,
      // Ephemeral pane pointers don't belong to the new chat — a same-id tile in
      // its split must not inherit chat A's focus. activeAgentTile (the coarse
      // pointer) resets with focus so the two stay consistent.
      focusedTile: null,
      activeAgentTile: 'agent:primary',
    });
  }

  const handleChatSelect = useCallback(
    (selectedChatId: string) => {
      navigate(`/chat/${selectedChatId}`);
    },
    [navigate],
  );

  // Sidebar is always available on chat pages — it holds navigation, settings, and logout
  const sidebarContent = useMemo(() => {
    return (
      <Sidebar
        workspaces={workspaces}
        selectedChatId={chatId || null}
        selectedChatWorkspaceId={currentChat?.workspace_id}
        selectedChatParentId={currentChat?.parent_chat_id}
        onChatSelect={handleChatSelect}
      />
    );
  }, [
    workspaces,
    chatId,
    currentChat?.workspace_id,
    currentChat?.parent_chat_id,
    handleChatSelect,
  ]);

  useLayoutSidebar(sidebarContent);

  const renderNonTerminalView = useCallback(
    (tileId: TileId, isVisible: boolean): ReactNode => {
      if (tileId === 'agent:primary') return <ChatComponent />;
      const slot = splitSlotOfTile(tileId);
      const splitChatId = slot ? splitChatIds[slot - 1] : undefined;
      if (tileIdToViewType(tileId) === 'agent') {
        return splitChatId ? <AgentPane chatId={splitChatId} /> : null;
      }
      // Split tiles render their chat's own sandbox/cwd. The terminal
      // is handled in renderView's terminal branch, so it's a no-op here.
      if (slot && !splitChatId) return null;
      const paneChatId = splitChatId ?? chatId;
      switch (tileIdToViewType(tileId)) {
        case 'editor':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <EditorPane chatId={paneChatId} />
            </Suspense>
          );
        case 'diff':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <DiffView chatId={paneChatId} isVisible={isVisible} />
            </Suspense>
          );
        default:
          return null;
      }
    },
    [chatId, splitChatIds],
  );

  const renderView = useCallback(
    (tileId: TileId, isVisible: boolean): ReactNode => {
      const slot = splitSlotOfTile(tileId);
      const splitChatId = slot ? splitChatIds[slot - 1] : undefined;
      const splitChat = slot
        ? [splitQuery1.data, splitQuery2.data, splitQuery3.data][slot - 1]
        : undefined;
      const isTerminal = tileIdToViewType(tileId) === 'terminal';
      const terminalSandboxId = slot
        ? (splitChat?.sandbox_id ?? undefined)
        : currentChat?.sandbox_id;
      const terminalChatId = slot ? splitChatId : currentChat?.id;
      // Worktree chats get their shell spawned inside the worktree so the
      // terminal matches what the agent/editor/diff views operate on.
      const terminalWorktreeCwd = slot
        ? (splitChat?.worktree_cwd ?? undefined)
        : (currentChat?.worktree_cwd ?? undefined);
      return (
        <div
          className={styles.tile}
          // Record focus on any interaction so shortcuts and the active tab both
          // track the pane in use (focusTile derives the chat from the tile).
          onPointerDownCapture={() => useUIStore.getState().focusTile(tileId)}
        >
          <div className={isTerminal ? styles.fill : styles.hidden}>
            <Suspense fallback={viewLoadingFallback}>
              <TerminalContainer
                sandboxId={terminalSandboxId}
                chatId={terminalChatId}
                worktreeCwd={terminalWorktreeCwd}
                // Only fit/focus the terminal when its tile is actually on screen —
                // a background tab is mounted but hidden (zero-size container).
                isVisible={isTerminal && isVisible}
                panelKey={`tile-${tileId}`}
              />
            </Suspense>
          </div>
          <div className={isTerminal ? styles.hidden : styles.fill}>
            {renderNonTerminalView(tileId, isVisible)}
          </div>
        </div>
      );
    },
    [
      currentChat,
      renderNonTerminalView,
      splitChatIds,
      splitQuery1.data,
      splitQuery2.data,
      splitQuery3.data,
    ],
  );

  if (!chatId) return <Navigate to="/" />;

  return (
    <ChatProvider
      chatId={chatId}
      sandboxId={currentChat?.sandbox_id}
      worktreeCwd={worktreeCwd}
      parentChatId={currentChat?.parent_chat_id ?? undefined}
      fileStructure={fileStructure}
      customSkills={workspaceResources?.skills}
      builtinSlashCommands={workspaceResources?.builtin_slash_commands}
      personas={settings?.personas}
    >
      <ChatSessionOrchestrator
        key={chatId}
        chatId={chatId}
        currentChat={currentChat}
        fetchedMessages={fetchedMessages}
        hasFetchedMessages={hasFetchedMessages}
        messagesQuery={messagesQuery}
      >
        <div className={styles['chat-root']}>
          <div className={styles.surface}>
            <SplitViewContainer renderView={renderView} />
          </div>
          <CommandMenu />
          {subThreadDialogOpen && <SubThreadDialog />}
          {createCommitDialogOpen && (
            <Suspense fallback={null}>
              <CreateCommitDialog
                onClose={() => useUIStore.getState().setCreateCommitDialogOpen(false)}
              />
            </Suspense>
          )}
          {createPRDialogOpen && (
            <Suspense fallback={null}>
              <CreatePRDialog onClose={() => useUIStore.getState().setCreatePRDialogOpen(false)} />
            </Suspense>
          )}
          {createBranchDialogOpen && (
            <Suspense fallback={null}>
              <CreateBranchDialog
                onClose={() => useUIStore.getState().setCreateBranchDialogOpen(false)}
              />
            </Suspense>
          )}
        </div>
      </ChatSessionOrchestrator>
    </ChatProvider>
  );
}
