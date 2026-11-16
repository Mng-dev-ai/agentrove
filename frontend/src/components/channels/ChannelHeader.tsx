import { useMatch } from 'react-router-dom';
import { useChannelQuery } from '@/hooks/queries/useChannelQueries';
import styles from './ChannelHeader.module.scss';

export function ChannelHeader() {
  const channelId = useMatch('/channels/:channelId')?.params.channelId;
  const { data: channel } = useChannelQuery(channelId);

  if (!channel) return null;

  return <span className={styles.title}>#{channel.name}</span>;
}
