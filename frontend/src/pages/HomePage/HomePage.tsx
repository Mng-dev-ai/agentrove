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
import { useNewThreadStore } from '@/store/newThreadStore';
import { useUIStore } from '@/store/uiStore';
import { recordedThreadStatus, resolveRootTarget } from './rootTarget';
import styles from './HomePage.module.scss';

export function HomePage() {
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
    lastThreadStatus: lastThread ? recordedThreadStatus(recordQuery) : 'gone',
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
        <div className={styles.empty}>
          <h1 className={styles.title}>No threads yet</h1>
          <p className={styles.text}>
            Start a thread with one agent, or pick several to work on it together.
          </p>
          <Button onClick={() => useNewThreadStore.getState().open()}>New thread</Button>
        </div>
      )}
      <ChatProvider>
        <CommandMenu />
      </ChatProvider>
    </>
  );
}
