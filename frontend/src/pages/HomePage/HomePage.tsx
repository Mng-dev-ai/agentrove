import { useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar/Sidebar';
import { useLayoutSidebar } from '@/components/layout/Layout/layoutState';
import { Button } from '@/components/ui/primitives/Button/Button';
import { CommandMenu } from '@/components/ui/command-menu/CommandMenu';
import { ChatProvider } from '@/contexts/ChatContext';
import { useCommandMenu } from '@/hooks/useCommandMenu';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useChannelQuery, useMachinesChannels } from '@/hooks/queries/useChannelQueries';
import { useSidebarChatLists } from '@/hooks/queries/useSidebarChatLists';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useAuthStore } from '@/store/authStore';
import { useNewThreadStore } from '@/store/newThreadStore';
import { useUIStore } from '@/store/uiStore';
import { resolveRootTarget } from './rootTarget';
import styles from './HomePage.module.scss';

function EmptyThreads({ action }: { action: { label: string; onClick: () => void } }) {
  return (
    <div className={styles.empty}>
      <h1 className={styles.title}>No threads yet</h1>
      <p className={styles.text}>
        Start a thread with one agent, or pick several to work on it together.
      </p>
      <Button onClick={action.onClick}>{action.label}</Button>
    </div>
  );
}

function ThreadHome() {
  const navigate = useNavigate();
  useCommandMenu();
  const workspaces = useWorkspacesList();
  const lastThread = useUIStore((state) => state.lastThread);
  const chatQuery = useChatQuery(lastThread?.kind === 'chat' ? lastThread.id : undefined);
  const channelQuery = useChannelQuery(lastThread?.kind === 'channel' ? lastThread.id : undefined);
  const recordQuery = lastThread?.kind === 'chat' ? chatQuery : channelQuery;
  const { pinnedChats, recentChats, isLoadingChats, isLoadingPinned } =
    useSidebarChatLists(workspaces);
  const { machineChannels, isLoading: isLoadingChannels } = useMachinesChannels(true);
  const target = resolveRootTarget({
    lastThread,
    // An error outranks data: a cached channel list can seed a channel that now answers 404
    lastThreadStatus: !lastThread
      ? 'gone'
      : recordQuery.isError
        ? 'gone'
        : recordQuery.data
          ? 'exists'
          : 'pending',
    chats: [...pinnedChats, ...recentChats],
    channels: machineChannels.map(({ channel }) => channel),
    isLoadingThreads: isLoadingChats || isLoadingPinned || isLoadingChannels,
  });

  const sidebarContent = useMemo(
    () => (
      <Sidebar
        workspaces={workspaces}
        selectedChatId={null}
        onChatSelect={(chatId) => navigate(`/chat/${chatId}`)}
      />
    ),
    [workspaces, navigate],
  );
  useLayoutSidebar(sidebarContent);

  if (target.kind === 'thread') return <Navigate to={target.path} replace />;
  return (
    <>
      {target.kind === 'empty' && (
        <EmptyThreads
          action={{ label: 'New thread', onClick: () => useNewThreadStore.getState().open() }}
        />
      )}
      <ChatProvider>
        <CommandMenu />
      </ChatProvider>
    </>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  if (isAuthenticated) return <ThreadHome />;
  return <EmptyThreads action={{ label: 'Get started', onClick: () => navigate('/signup') }} />;
}
