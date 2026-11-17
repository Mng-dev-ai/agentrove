import React, { useState } from 'react';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { formatDuration } from '@/utils/date';
import styles from './WorkedRollup.module.scss';

interface WorkedRollupProps {
  durationMs: number | null;
  onExpand?: () => void;
  children: React.ReactNode;
}

// Completed-turn tool/thinking trace behind one header so the final answer leads.
export function WorkedRollup({ durationMs, onExpand, children }: WorkedRollupProps) {
  // Older messages persisted before duration tracking have no duration_ms.
  const label =
    durationMs != null && durationMs > 0 ? `Worked for ${formatDuration(durationMs)}` : 'Worked';

  return (
    <RollupRow label={label} onExpand={onExpand}>
      {children}
    </RollupRow>
  );
}

interface RollupRowProps {
  label: string;
  onExpand?: () => void;
  children: React.ReactNode;
}

export function RollupRow({ label, onExpand, children }: RollupRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={styles['worked-rollup']}>
      <Button
        type="button"
        variant="unstyled"
        aria-expanded={isExpanded}
        onClick={() => {
          if (!isExpanded) onExpand?.();
          setIsExpanded(!isExpanded);
        }}
        className={styles['rollup-button']}
      >
        <span>{label}</span>
        <ChevronRight
          className={clsx(
            styles['rollup-chevron'],
            isExpanded && styles['rollup-chevron--expanded'],
          )}
        />
      </Button>
      {isExpanded && <div className={styles['rollup-content']}>{children}</div>}
    </div>
  );
}

export function TraceLoadState({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  if (!failed) return <p className={styles['trace-status']}>Loading…</p>;
  return (
    <p className={styles['trace-status']}>
      Couldn&apos;t load this run&apos;s details.{' '}
      <Button type="button" variant="unstyled" onClick={onRetry} className={styles['trace-retry']}>
        Retry
      </Button>
    </p>
  );
}
