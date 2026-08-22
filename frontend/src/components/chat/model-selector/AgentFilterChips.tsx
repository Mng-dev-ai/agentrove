import { memo } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import type { AgentKind } from '@/types/chat.types';
import styles from './AgentFilterChips.module.scss';

const AGENT_LABELS: Record<AgentKind, string> = {
  antigravity: 'Antigravity',
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot',
  cursor: 'Cursor',
  grok: 'Grok',
  opencode: 'OpenCode',
};

export interface AgentFilterChipsProps {
  agentKinds: AgentKind[];
  value: AgentKind | null;
  onChange: (kind: AgentKind | null) => void;
}

export const AgentFilterChips = memo(function AgentFilterChips({
  agentKinds,
  value,
  onChange,
}: AgentFilterChipsProps) {
  const chips: { kind: AgentKind | null; label: string }[] = [
    { kind: null, label: 'All' },
    ...agentKinds.map((kind) => ({ kind, label: AGENT_LABELS[kind] })),
  ];

  return (
    <div className={styles['agent-filter-chips']}>
      {chips.map(({ kind, label }) => (
        // Empty content renders no bubble — the "All" chip's label is already visible
        <FloatingTooltip key={kind ?? 'all'} content={kind ? label : ''}>
          <Button
            type="button"
            variant="unstyled"
            aria-label={kind ? label : undefined}
            aria-pressed={value === kind}
            onClick={() => onChange(kind)}
            className={clsx(
              styles.chip,
              kind && styles['chip--icon'],
              value === kind && styles['chip--active'],
            )}
          >
            {kind ? <ProviderIcon agentKind={kind} className={styles['chip-icon']} /> : label}
          </Button>
        </FloatingTooltip>
      ))}
    </div>
  );
});
