import { useEffect, useMemo, useCallback, useRef, ReactNode, lazy, Suspense } from 'react';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { useLayoutSidebar } from '@/components/layout/layoutState';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { SplitViewContainer } from '@/components/ui/SplitViewContainer';
import { CommandMenu } from '@/components/ui/CommandMenu';
import { useCommandMenu } from '@/hooks/useCommandMenu';
import { useActiveViews } from '@/hooks/useActiveViews';
import { viewLoadingFallback } from '@/components/ui/shared/ViewLoadingFallback';
import type { AgentTileId, MosaicTileId, ViewType } from '@/types/ui.types';
import { isSecondaryTile, tileIdToViewType, VIEW_LABELS, VIEW_TYPES } from '@/utils/mosaicHelpers';
import { Chat as ChatComponent } from '@/components/chat/chat-window/Chat';
import { ChatSessionOrchestrator } from '@/components/chat/chat-window/ChatSessionOrchestrator';
import { AgentPane } from '@/components/chat/chat-window/AgentPane';
import { useChatData } from '@/hooks/useChatData';
import { useActiveChat } from '@/hooks/useActiveChat';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useSandboxFiles } from '@/hooks/useSandboxFiles';
import { useWorkspacesList, useWorkspaceResourcesQuery } from '@/hooks/queries/useWorkspaceQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { ChatProvider } from '@/contexts/ChatContext';
import { CreateSubThreadDialog } from '@/components/chat/sub-threads/CreateSubThreadDialog';

const EditorPane = lazy(() =>
  import('@/components/editor/editor-core/EditorPane').then((m) => ({ default: m.EditorPane })),
);
const SecretsView = lazy(() =>
  import('@/components/sandbox/secrets/SecretsView').then((m) => ({ default: m.SecretsView })),
);
const DiffView = lazy(() =>
  import('@/components/sandbox/git/DiffView').then((m) => ({ default: m.DiffView })),
);
const TerminalContainer = lazy(() =>
  import('@/components/sandbox/terminal/Container').then((m) => ({ default: m.Container })),
);
const CreateBranchDialog = lazy(() =>
  import('@/components/chat/github/CreateBranchDialog').then((m) => ({
    default: m.CreateBranchDialog,
  })),
);
const CreateCommitDialog = lazy(() =>
  import('@/components/chat/github/CreateCommitDialog').then((m) => ({
    default: m.CreateCommitDialog,
  })),
);
const CreatePRDialog = lazy(() =>
  import('@/components/chat/github/CreatePRDialog').then((m) => ({ default: m.CreatePRDialog })),
);

// Mount-gated wrapper (matches the git dialogs' pattern) so useActiveChat's
// pane subscriptions don't re-render the whole page on every pane switch.
function SubThreadDialog() {
  // Sub-threads branch off the pane the user is in — in split view that's the
  // secondary chat when it's the active pane.
  const parentChat = useActiveChat();
  if (!parentChat || parentChat.parent_chat_id) return null;
  return (
    <CreateSubThreadDialog
      parentChat={parentChat}
      onClose={() => useUIStore.getState().setSubThreadDialogOpen(false)}
    />
  );
}

export function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  useCommandMenu();
  const subThreadDialogOpen = useUIStore((s) => s.subThreadDialogOpen);
  const createCommitDialogOpen = useUIStore((s) => s.createCommitDialogOpen);
  const createPRDialogOpen = useUIStore((s) => s.createPRDialogOpen);
  const createBranchDialogOpen = useUIStore((s) => s.createBranchDialogOpen);

  const activeViews = useActiveViews();
  const secondaryChatId = useUIStore((s) => s.secondaryChatId);
  const isMobile = useIsMobile();

  const { currentChat, fetchedMessages, hasFetchedMessages, messagesQuery } = useChatData(chatId);

  // Shares the chat-query cache with AgentPane. Used as error guard
  // (a deleted secondary chat collapses the split) and tile-label source.
  const secondaryQuery = useChatQuery(secondaryChatId ?? undefined, {
    enabled: !!secondaryChatId,
  });
  const secondaryQueryIsError = secondaryQuery.isError;
  useEffect(() => {
    if (secondaryChatId && secondaryQueryIsError) {
      useUIStore.getState().closeSplitChat();
    }
  }, [secondaryChatId, secondaryQueryIsError]);

  // mosaicLayout isn't persisted; rebuild it on refresh and when returning to desktop.
  useEffect(() => {
    if (secondaryChatId === chatId) {
      useUIStore.getState().closeSplitChat();
      return;
    }
    if (!isMobile && secondaryChatId) {
      useUIStore.getState().openChatInSplit(secondaryChatId);
    }
  }, [chatId, isMobile, secondaryChatId]);

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
  const { data: settings } = useSettingsQuery();

  const { data: workspaceResources } = useWorkspaceResourcesQuery(currentChat?.workspace_id);

  const prevChatIdForResetRef = useRef(chatId);

  useEffect(() => {
    useChatStore.getState().setCurrentChat(currentChat || null);
  }, [currentChat]);

  if (prevChatIdForResetRef.current !== chatId) {
    prevChatIdForResetRef.current = chatId;
    const ui = useUIStore.getState();
    if (ui.secondaryChatId === chatId) {
      ui.closeSplitChat();
    }
    if (!ui.secondaryChatId) {
      ui.setCurrentView('agent');
    }
    useUIStore.setState({
      pendingFilePath: null,
      pendingFileJump: null,
      pendingDiffFile: null,
      subThreadDialogOpen: false,
      createCommitDialogOpen: false,
      createPRDialogOpen: false,
      createBranchDialogOpen: false,
    });
  }

  const handleChatSelect = useCallback(
    (selectedChatId: string) => {
      navigate(`/chat/${selectedChatId}`);
    },
    [navigate],
  );

  // Auto-close sidebar when switching to non-agent views (editor-only, terminal-only, etc.)
  // to reclaim the 300px. Users can re-open via the TitleBar toggle.
  const agentVisible = activeViews.includes('agent');
  useEffect(() => {
    if (!agentVisible) {
      useUIStore.getState().setSidebarOpen(false);
    }
  }, [agentVisible]);

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
    (tileId: MosaicTileId): ReactNode => {
      if (tileId === 'agent:primary') return <ChatComponent />;
      if (tileId === 'agent:secondary') {
        if (!secondaryChatId) return null;
        return <AgentPane chatId={secondaryChatId} />;
      }
      // Secondary tiles render the second chat's own sandbox/cwd. The terminal
      // is handled in renderView's terminal branch, so it's a no-op here.
      const isSecondary = isSecondaryTile(tileId);
      if (isSecondary && !secondaryChatId) return null;
      const paneChat = isSecondary ? secondaryQuery.data : currentChat;
      const paneChatId = isSecondary ? (secondaryChatId ?? undefined) : chatId;
      switch (tileIdToViewType(tileId)) {
        case 'editor':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <EditorPane chatId={paneChatId} />
            </Suspense>
          );
        case 'secrets':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <SecretsView sandboxId={paneChat?.sandbox_id ?? undefined} />
            </Suspense>
          );
        case 'diff':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <DiffView chatId={paneChatId} />
            </Suspense>
          );
        default:
          return null;
      }
    },
    [chatId, currentChat, secondaryChatId, secondaryQuery.data?.sandbox_id],
  );

  const renderView = useCallback(
    (tileId: MosaicTileId, slot: string): ReactNode => {
      const isSecondary = isSecondaryTile(tileId);
      const isTerminal = tileId === 'terminal' || tileId === 'terminal:secondary';
      // Every tile maps to the chat it shows; recording it on any interaction
      // keeps pane-scoped shortcuts aimed at the chat the user is actually in.
      const activePane: AgentTileId = isSecondary ? 'agent:secondary' : 'agent:primary';
      // The secondary terminal runs in the second chat's sandbox; the hidden
      // terminals kept alive in other slots stay on the primary chat.
      const terminalSandboxId = isSecondary
        ? (secondaryQuery.data?.sandbox_id ?? undefined)
        : currentChat?.sandbox_id;
      const terminalChatId = isSecondary ? (secondaryChatId ?? undefined) : currentChat?.id;
      return (
        <div
          className="relative flex h-full w-full"
          onPointerDownCapture={() => useUIStore.getState().setActiveAgentTile(activePane)}
        >
          <div className={isTerminal ? 'flex h-full w-full' : 'hidden'}>
            <Suspense fallback={viewLoadingFallback}>
              <TerminalContainer
                sandboxId={terminalSandboxId}
                chatId={terminalChatId}
                isVisible={isTerminal}
                panelKey={slot}
              />
            </Suspense>
          </div>
          <div className={isTerminal ? 'hidden' : 'flex h-full w-full'}>
            {renderNonTerminalView(tileId)}
          </div>
        </div>
      );
    },
    [currentChat, renderNonTerminalView, secondaryChatId, secondaryQuery.data?.sandbox_id],
  );

  const handleCloseTile = useCallback(
    (tileId: MosaicTileId) => {
      const ui = useUIStore.getState();
      if (tileId === 'agent:secondary') {
        ui.closeSplitChat();
        return;
      }
      if (tileId === 'agent:primary' && ui.secondaryChatId && chatId) {
        const newPrimary = ui.swapChatPanes(chatId);
        if (newPrimary) {
          navigate(`/chat/${newPrimary}`);
          ui.closeSplitChat();
          return;
        }
      }
      ui.removeTileFromMosaic(tileId);
    },
    [chatId, navigate],
  );

  const agentTitles = useMemo<Partial<Record<MosaicTileId, string>>>(() => {
    const titles: Partial<Record<MosaicTileId, string>> = {};
    const primaryTitle = currentChat?.title;
    const secondaryTitle = secondaryQuery.data?.title;
    if (primaryTitle) titles['agent:primary'] = primaryTitle;
    if (secondaryChatId && secondaryTitle) {
      titles['agent:secondary'] = secondaryTitle;
      // Each non-agent view's two tiles can coexist in split-chat view — name
      // them by chat so the two copies (primary/secondary) are distinguishable.
      for (const view of VIEW_TYPES) {
        if (view === 'agent') continue;
        if (primaryTitle) titles[view] = `${primaryTitle} · ${VIEW_LABELS[view]}`;
        titles[`${view}:secondary`] = `${secondaryTitle} · ${VIEW_LABELS[view]}`;
      }
    }
    return titles;
  }, [currentChat?.title, secondaryChatId, secondaryQuery.data?.title]);

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
        chatId={chatId}
        currentChat={currentChat}
        fetchedMessages={fetchedMessages}
        hasFetchedMessages={hasFetchedMessages}
        messagesQuery={messagesQuery}
        refetchFilesMetadata={refetchFilesMetadata}
      >
        <div className="relative flex h-full">
          <div className="flex h-full flex-1 overflow-hidden bg-surface text-text-primary dark:bg-surface-dark dark:text-text-dark-primary">
            <SplitViewContainer
              renderView={renderView}
              agentTitles={agentTitles}
              onCloseTile={handleCloseTile}
            />
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
