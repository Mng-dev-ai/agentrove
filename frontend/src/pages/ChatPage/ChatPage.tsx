import { useEffect, useMemo, useCallback, useRef, ReactNode } from 'react';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar/Sidebar';
import { useLayoutSidebar } from '@/components/layout/Layout/layoutState';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { useCommandMenu } from '@/hooks/useCommandMenu';
import { useActiveViews } from '@/hooks/useActiveViews';
import type { TileId, ViewType } from '@/types/ui.types';
import { splitSlotOfTile } from '@/utils/tileHelpers';
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
import { useCloudWorkspacesQuery } from '@/hooks/queries/useCloudQueries';
import { useIsCloudChat } from '@/utils/chatOrigin';
import { useSettingsForChatQuery } from '@/hooks/queries/useSettingsQueries';
import { ChatProvider } from '@/contexts/ChatContext';
import { SessionPanel } from '@/components/chat/session-panel/SessionPanel';
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
  useMountEffect(() => {
    if (chatId) useUIStore.getState().loadWorkspaceForChat(chatId);
    return () => useUIStore.getState().stashWorkspace();
  });

  // Rebuild only if an agent tile is missing — keep compaction / full-screen layouts.
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
  // Marks seen (last_viewed_at + clears sidebar unread).
  useEffect(() => {
    if (chatId) void markChatViewed(queryClient, chatId);
  }, [chatId, queryClient]);
  // An app-posted message (e.g. a sub-thread notice) bumps the chat unread while it is open.
  const isViewedChatUnread = currentChat?.unread === true;
  useEffect(() => {
    if (chatId && isViewedChatUnread) void markChatViewed(queryClient, chatId);
  }, [chatId, isViewedChatUnread, queryClient]);
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
  // Cloud chats' workspaces live on the VPS, not in the local list.
  const isCloud = useIsCloudChat(chatId);
  const { data: cloudWorkspaces } = useCloudWorkspacesQuery(isCloud);
  const currentWorkspace = (isCloud ? cloudWorkspaces : workspaces)?.find(
    (w) => w.id === currentChat?.workspace_id,
  );
  // Cloud chats resolve personas against the VPS settings list.
  const { data: settings } = useSettingsForChatQuery(chatId);

  const { data: workspaceResources } = useWorkspaceResourcesQuery(
    currentChat?.workspace_id,
    chatId,
  );

  const prevChatIdForResetRef = useRef(chatId);

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

  if (prevChatIdForResetRef.current !== chatId) {
    prevChatIdForResetRef.current = chatId;
    const ui = useUIStore.getState();
    if (chatId) ui.loadWorkspaceForChat(chatId);
    if (chatId && ui.splitChatIds.includes(chatId)) {
      ui.closeSplitChat(chatId);
    }
    useUIStore.setState({
      pendingFileOpen: null,
      pendingDiffMode: null,
      subThreadDialogOpen: false,
      createCommitDialogOpen: false,
      createPRDialogOpen: false,
      createBranchDialogOpen: false,
      // Don't inherit prior chat's focus onto a same-id split tile.
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
      const paneChatId = slot ? splitChatIds[slot - 1] : chatId;
      const paneChat = slot
        ? [splitQuery1.data, splitQuery2.data, splitQuery3.data][slot - 1]
        : currentChat;
      return (
        <WorkspaceTile
          tileId={tileId}
          isVisible={isVisible}
          chatId={paneChatId}
          chat={paneChat}
          agent={
            tileId === 'agent:primary' ? (
              <ChatComponent />
            ) : (
              paneChatId && <AgentPane chatId={paneChatId} />
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
        <WorkspaceSurface
          renderView={renderView}
          sessionPanel={
            currentChat && <SessionPanel chat={currentChat} workspace={currentWorkspace} />
          }
        >
          {subThreadDialogOpen && <SubThreadDialog />}
        </WorkspaceSurface>
      </ChatSessionOrchestrator>
    </ChatProvider>
  );
}
