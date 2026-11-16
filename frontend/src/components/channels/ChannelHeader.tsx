import { useMatch } from 'react-router-dom';
import { useChannelQuery } from '@/hooks/queries/useChannelQueries';
import { AppBarTitle } from '@/components/layout/ChatTabs/ChatTabs';

export function ChannelHeader() {
  const channelId = useMatch('/channels/:channelId')?.params.channelId;
  const { data: channel } = useChannelQuery(channelId);

  if (!channel) return null;

  return <AppBarTitle>#{channel.name}</AppBarTitle>;
}
