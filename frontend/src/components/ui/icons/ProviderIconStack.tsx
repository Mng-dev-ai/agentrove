import clsx from 'clsx';
import type { AgentKind } from '@/types/chat.types';
import { ProviderIcon } from './ProviderIcon';
import styles from './ProviderIconStack.module.scss';

const MAX_STACKED_ICONS = 3;

interface ProviderIconStackProps {
  agentKinds: AgentKind[];
  className?: string;
  iconClassName?: string;
}

export function ProviderIconStack({
  agentKinds,
  className,
  iconClassName,
}: ProviderIconStackProps) {
  return (
    <span className={clsx(styles.stack, className)} aria-hidden>
      {agentKinds.slice(0, MAX_STACKED_ICONS).map((agentKind, index) => (
        <span key={index} className={styles.chip}>
          <ProviderIcon agentKind={agentKind} className={clsx(styles.icon, iconClassName)} />
        </span>
      ))}
    </span>
  );
}
