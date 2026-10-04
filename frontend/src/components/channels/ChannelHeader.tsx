import { GitBranch, GitFork, Hash } from 'lucide-react';
import { useMatch } from 'react-router-dom';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { TitleBarTab, TitleBarTabs } from '@/components/layout/TitleBarTab/TitleBarTab';
import { shortenBranchName } from '@/components/chat/branch-selector/branchItems';
import { useChannelQuery } from '@/hooks/queries/useChannelQueries';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { getAgentKindForModelId } from '@/types/chat.types';
import type { Channel, ChannelMember } from '@/types/channel.types';
import styles from './ChannelHeader.module.scss';

function memberDetails(member: ChannelMember, modelName: string): string {
  return [modelName, member.persona, member.thinking_mode].filter(Boolean).join(' · ');
}

function ChannelBranch({ channel }: { channel: Channel }) {
  const { branch, worktree } = channel;
  if (!branch && !worktree) return null;
  const Icon = worktree ? GitFork : GitBranch;
  const label = branch ? shortenBranchName(branch) : 'worktree';
  const tooltip = worktree
    ? `Shared worktree${branch ? ` from ${branch}` : ''}`
    : `Branch ${branch}`;

  return (
    <FloatingTooltip content={tooltip}>
      <span className={styles.branch}>
        <Icon className={styles['branch-icon']} />
        <span className={styles['branch-name']}>{label}</span>
      </span>
    </FloatingTooltip>
  );
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
      <div className={styles.aside}>
        <ChannelBranch channel={channel} />
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
    </div>
  );
}
