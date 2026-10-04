import { Hash } from 'lucide-react';
import { useMatch } from 'react-router-dom';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { TitleBarTab, TitleBarTabs } from '@/components/layout/TitleBarTab/TitleBarTab';
import { useChannelQuery } from '@/hooks/queries/useChannelQueries';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { getAgentKindForModelId } from '@/types/chat.types';
import type { ChannelMember } from '@/types/channel.types';
import styles from './ChannelHeader.module.scss';

function memberDetails(member: ChannelMember, modelName: string): string {
  return [modelName, member.persona, member.thinking_mode].filter(Boolean).join(' · ');
}

export function ChannelHeader() {
  const channelId = useMatch('/channels/:channelId')?.params.channelId;
  const { data: channel } = useChannelQuery(channelId);
  const modelMap = useModelMap();

  if (!channel) return null;

  return (
    <div className={styles.header}>
      <TitleBarTabs>
        <TitleBarTab
          icon={<Hash className={styles['tab-icon']} />}
          title={channel.name}
          isActive={true}
        />
      </TitleBarTabs>
      <ul className={styles.members} aria-label="Channel members">
        {channel.members.map((member) => (
          <li key={member.id}>
            <FloatingTooltip
              content={memberDetails(
                member,
                modelMap.get(member.model_id)?.name ?? member.model_id,
              )}
            >
              <span className={styles.member}>
                <ProviderIcon
                  agentKind={getAgentKindForModelId(member.model_id)}
                  className={styles['member-icon']}
                />
                <span className={styles['member-name']}>{member.display_name}</span>
              </span>
            </FloatingTooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}
