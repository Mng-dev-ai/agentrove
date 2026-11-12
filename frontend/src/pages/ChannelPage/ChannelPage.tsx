import { useCallback, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar/Sidebar';
import { useLayoutSidebar } from '@/components/layout/Layout/layoutState';
import {
  WorkspaceSurface,
  WorkspaceTile,
} from '@/components/layout/WorkspaceSurface/WorkspaceSurface';
import { ChatProvider } from '@/contexts/ChatContext';
import { useCommandMenu } from '@/hooks/useCommandMenu';
import { ChannelView } from '@/components/channels/ChannelView';
import { SessionPanel } from '@/components/chat/session-panel/SessionPanel';
import { LoadingScreen } from '@/components/ui/LoadingScreen/LoadingScreen';
import { useChannelQuery } from '@/hooks/queries/useChannelQueries';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useSandboxFiles } from '@/hooks/useSandboxFiles';
import { useChatStore } from '@/store/chatStore';
import { useUIStore } from '@/store/uiStore';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useMachineWorkspacesQuery } from '@/hooks/queries/useMachineQueries';
import { channelMachineId } from '@/store/machineOrigin';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { Channel } from '@/types/channel.types';
import type { TileId } from '@/types/ui.types';
import type { Workspace } from '@/types/workspace.types';

function ChannelWorkspace({
  channel,
  workspace,
}: {
  channel: Channel;
  workspace: Workspace | undefined;
}) {
  const workspaceChatId = channel.anchor_chat_id;
  const { data: workspaceChat } = useChatQuery(workspaceChatId);
  const { fileStructure } = useSandboxFiles(workspaceChat, workspaceChatId);
  const isWorkspaceLoaded = useUIStore((s) => s.currentWorkspaceChatId === channel.id);

  // Chat-scoped git actions (commit, PR, branch) resolve the channel's worktree through it.
  useEffect(() => {
    useChatStore.getState().setCurrentChat(workspaceChat ?? null);
    return () => useChatStore.getState().setCurrentChat(null);
  }, [workspaceChat]);

  const renderView = useCallback(
    (tileId: TileId, isVisible: boolean): ReactNode => (
      <WorkspaceTile
        tileId={tileId}
        isVisible={isVisible}
        chatId={workspaceChatId}
        chat={workspaceChat}
        agent={<ChannelView key={channel.id} channel={channel} />}
      />
    ),
    [channel, workspaceChatId, workspaceChat],
  );

  return (
    // File links, open-in-editor and the command menu resolve against the shared workspace.
    <ChatProvider
      chatId={workspaceChatId}
      sandboxId={workspaceChat?.sandbox_id}
      worktreeCwd={workspaceChat?.worktree_cwd ?? undefined}
      fileStructure={fileStructure}
    >
      {isWorkspaceLoaded && (
        <WorkspaceSurface
          renderView={renderView}
          sessionPanel={
            workspaceChat && (
              <SessionPanel chat={workspaceChat} workspace={workspace} channel={channel} />
            )
          }
        />
      )}
    </ChatProvider>
  );
}

export function ChannelPage() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  useCommandMenu();

  // Split chats are chat-only; each channel keeps its own view layout.
  useLayoutEffect(() => {
    if (!channelId) return;
    const ui = useUIStore.getState();
    ui.closeSplitChat();
    ui.loadWorkspace(channelId);
    return () => useUIStore.getState().stashWorkspace();
  }, [channelId]);

  const workspaces = useWorkspacesList();
  const { data: channel, isError } = useChannelQuery(channelId);
  const channelMachine = channelMachineId(channelId);
  const isRemote = channelMachine !== LOCAL_MACHINE_ID;
  const { data: machineWorkspaces } = useMachineWorkspacesQuery(channelMachine, isRemote);

  useEffect(() => {
    if (isError) navigate('/', { replace: true });
  }, [isError, navigate]);

  const sidebarContent = useMemo(
    () => (
      <Sidebar
        workspaces={workspaces}
        selectedChatId={null}
        selectedChannelId={channelId ?? null}
        selectedChatWorkspaceId={channel?.workspace_id}
        onChatSelect={(chatId) => navigate(`/chat/${chatId}`)}
      />
    ),
    [workspaces, channelId, channel?.workspace_id, navigate],
  );

  useLayoutSidebar(sidebarContent);

  if (!channelId) return <Navigate to="/" />;
  if (!channel) return <LoadingScreen />;

  return (
    <ChannelWorkspace
      channel={channel}
      workspace={(isRemote ? machineWorkspaces : workspaces)?.find(
        (w) => w.id === channel.workspace_id,
      )}
    />
  );
}
