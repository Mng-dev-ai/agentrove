import type { AgentKind } from '@/types/chat.types';
import { ProviderIcon } from './ProviderIcon';
import styles from './ProviderIconStack.module.scss';

const MAX_STACKED_ICONS = 3;

interface ProviderIconStackProps {
  agentKinds: AgentKind[];
}

export function ProviderIconStack({ agentKinds }: ProviderIconStackProps) {
  return (
    <span className={styles.stack} aria-hidden>
      {agentKinds.slice(0, MAX_STACKED_ICONS).map((agentKind, index) => (
        <span key={index} className={styles.chip}>
          <ProviderIcon agentKind={agentKind} className={styles.icon} />
        </span>
      ))}
    </span>
  );
}
