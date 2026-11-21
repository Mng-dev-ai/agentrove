import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar/Sidebar';
import { useLayoutSidebar } from '@/components/layout/Layout/layoutState';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { useCommandMenu } from '@/hooks/useCommandMenu';
import { useActiveViews } from '@/hooks/useActiveViews';
import type { TileId, ViewType } from '@/types/ui.types';
import { agentTileFor, splitSlotOfTile, tileChatId } from '@/utils/tileHelpers';
import { Chat as ChatComponent } from '@/components/chat/chat-window/Chat';
import { ChatSessionOrchestrator } from '@/components/chat/chat-window/ChatSessionOrchestrator';
import { AgentPane } from '@/components/chat/chat-window/AgentPane';
import { useChatData } from '@/hooks/useChatData';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useQueryClient } from '@tanstack/react-query';
import { useChatQuery, markChatViewed } from '@/hooks/queries/useChatQueries';
import { useSandboxFiles } from '@/hooks/useSandboxFiles';
import { useWorkspacesList, useWorkspaceResourcesQuery } from '@/hooks/queries/useWorkspaceQueries';
import { useSettingsForChatQuery } from '@/hooks/queries/useSettingsQueries';
import { ChatProvider } from '@/contexts/ChatContext';
import {
  PaneSessionPanel,
  SessionPanelSlot,
} from '@/components/chat/session-panel/PaneSessionPanel';
import { SessionPanelSlotContext } from '@/contexts/SessionPanelSlotContext';
import { InTilePaneHeader } from '@/components/layout/PaneHeader/PaneHeader';
import {
  WorkspaceSurface,
  WorkspaceTile,
} from '@/components/layout/WorkspaceSurface/WorkspaceSurface';
import { SubThreadDialog } from './SubThreadDialog';

export function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  useCommandMenu();
  const subThreadDialogOpen = useUIStore((s) => s.subThreadDialogOpen);

  const activeViews = useActiveViews();
  const splitChatIds = useUIStore((s) => s.splitChatIds);
  const isMobile = useIsMobile();
  const isWorkspaceLoaded = useUIStore((s) => s.currentWorkspaceChatId === chatId);

  const { currentChat, fetchedMessages, hasFetchedMessages, messagesQuery } = useChatData(chatId);

  // Share AgentPane's chat-query cache; also drive split close-on-error.
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

  // Restore/stash per chat. Must run before split-rebuild below (else restore wipes it).
  const prevChatIdForResetRef = useRef(chatId);
  useLayoutEffect(() => {
    const ui = useUIStore.getState();
    const workspaceAlreadyLive = ui.currentWorkspaceChatId === chatId;
    if (chatId) ui.loadWorkspaceForChat(chatId);
    if (prevChatIdForResetRef.current !== chatId) {
      prevChatIdForResetRef.current = chatId;
      if (chatId && ui.splitChatIds.includes(chatId)) {
        ui.closeSplitChat(chatId);
      }
      const pendingDiffMode = ui.pendingDiffMode?.chatId === chatId ? ui.pendingDiffMode : null;
      useUIStore.setState({
        pendingFileOpen: null,
        pendingDiffMode,
        subThreadDialogOpen: false,
        createCommitDialogOpen: false,
        createPRDialogOpen: false,
        createBranchDialogOpen: false,
        // Don't inherit prior chat's focus onto a same-id split tile.
        ...(workspaceAlreadyLive
          ? {}
          : { focusedTile: null, activeAgentTile: 'agent:primary' as const }),
      });
      if (pendingDiffMode) {
        ui.rebuildSplitLayout();
        ui.toggleView('diff', false);
      }
    }
    return () => useUIStore.getState().stashWorkspace();
  }, [chatId]);

  // Rebuild only if an agent tile is missing — keep compaction / full-screen layouts.
  useEffect(() => {
    if (!isWorkspaceLoaded) return;
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
  }, [chatId, isMobile, splitChatIds, isWorkspaceLoaded]);

  const queryClient = useQueryClient();
  // Marks seen (last_viewed_at + clears sidebar unread).
  useEffect(() => {
    if (chatId) void markChatViewed(queryClient, chatId);
  }, [chatId, queryClient]);
  useEffect(() => {
    // Mobile keeps split ids but doesn't show panes — don't mark those seen.
    if (!isMobile) {
      for (const splitChatId of splitChatIds) void markChatViewed(queryClient, splitChatId);
    }
  }, [splitChatIds, isMobile, queryClient]);

  const { fileStructure, refetchFilesMetadata } = useSandboxFiles(currentChat, chatId);

  const worktreeCwd = currentChat?.worktree_cwd ?? undefined;

  const prevViewsRef = useRef<{
    views: ViewType[];
    chatId: string | undefined;
  }>({
    views: activeViews,
    chatId,
  });

  useEffect(() => {
    if (!currentChat?.sandbox_id || !isWorkspaceLoaded) return;

    const prev = prevViewsRef.current;
    prevViewsRef.current = { views: activeViews, chatId };

    if (
      prev.chatId === chatId &&
      activeViews.includes('editor') &&
      !prev.views.includes('editor')
    ) {
      refetchFilesMetadata();
    }
  }, [activeViews, chatId, isWorkspaceLoaded, currentChat?.sandbox_id, refetchFilesMetadata]);

  const workspaces = useWorkspacesList();
  const [sessionPanelSlot, setSessionPanelSlot] = useState<HTMLDivElement | null>(null);
  // Remote chats resolve personas against their machine's settings list.
  const { data: settings } = useSettingsForChatQuery(chatId);

  const { data: workspaceResources } = useWorkspaceResourcesQuery(
    currentChat?.workspace_id,
    chatId,
  );

  useEffect(() => {
    useChatStore.getState().setCurrentChat(currentChat || null);
  }, [currentChat]);

  // Channel member chats are only shown through their channel.
  const channelId = currentChat?.channel_id;
  useEffect(() => {
    if (!channelId || !chatId) return;
    useUIStore.getState().closeChatTab(chatId);
    navigate(`/channels/${channelId}`, { replace: true });
  }, [channelId, chatId, navigate]);

  const handleChatSelect = useCallback(
    (selectedChatId: string) => {
      navigate(`/chat/${selectedChatId}`);
    },
    [navigate],
  );

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

  const renderView = useCallback(
    (tileId: TileId, isVisible: boolean): ReactNode => {
      const slot = splitSlotOfTile(tileId);
      const paneChatId = tileChatId(tileId, splitChatIds, chatId);
      const paneChat = slot
        ? [splitQuery1.data, splitQuery2.data, splitQuery3.data][slot - 1]
        : currentChat;
      return (
        <WorkspaceTile
          tileId={tileId}
          isVisible={isVisible}
          chatId={paneChatId}
          chat={paneChat}
          header={
            isVisible && paneChatId && <InTilePaneHeader tileId={tileId} chatId={paneChatId} />
          }
          agent={
            tileId === 'agent:primary' ? (
              <>
                <ChatComponent />
                <PaneSessionPanel agentTile="agent:primary" chat={currentChat} />
              </>
            ) : (
              paneChatId && (
                <AgentPane key={paneChatId} chatId={paneChatId} agentTile={agentTileFor(tileId)} />
              )
            )
          }
        />
      );
    },
    [chatId, currentChat, splitChatIds, splitQuery1.data, splitQuery2.data, splitQuery3.data],
  );

  if (!chatId) return <Navigate to="/" />;
  if (channelId) return null;

  return (
    <ChatProvider
      chatId={chatId}
      sandboxId={currentChat?.sandbox_id}
      worktreeCwd={worktreeCwd}
      parentChatId={currentChat?.parent_chat_id ?? undefined}
      fileStructure={fileStructure}
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
        {isWorkspaceLoaded && (
          <SessionPanelSlotContext.Provider value={sessionPanelSlot}>
            <WorkspaceSurface
              renderView={renderView}
              sessionPanel={<SessionPanelSlot ref={setSessionPanelSlot} />}
            >
              {subThreadDialogOpen && <SubThreadDialog />}
            </WorkspaceSurface>
          </SessionPanelSlotContext.Provider>
        )}
      </ChatSessionOrchestrator>
    </ChatProvider>
  );
}
