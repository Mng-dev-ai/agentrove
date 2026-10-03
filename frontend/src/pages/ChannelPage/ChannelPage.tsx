import { useEffect, useMemo } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar/Sidebar';
import { useLayoutSidebar } from '@/components/layout/Layout/layoutState';
import { CommandMenu } from '@/components/ui/command-menu/CommandMenu';
import { useCommandMenu } from '@/hooks/useCommandMenu';
import { ChannelView } from '@/components/channels/ChannelView';
import { LoadingScreen } from '@/components/ui/LoadingScreen/LoadingScreen';
import { useChannelQuery } from '@/hooks/queries/useChannelQueries';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import styles from './ChannelPage.module.scss';

export function ChannelPage() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  useCommandMenu();
  const workspaces = useWorkspacesList();
  const { data: channel, isError } = useChannelQuery(channelId);

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
    <div className={styles.page}>
      <ChannelView key={channel.id} channel={channel} />
      <CommandMenu />
    </div>
  );
}
