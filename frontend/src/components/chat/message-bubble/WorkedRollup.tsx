import React, { useState } from 'react';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { formatDuration } from '@/utils/date';
import styles from './WorkedRollup.module.scss';

interface WorkedRollupProps {
  durationMs: number | null;
  children: React.ReactNode;
}

// Completed-turn tool/thinking trace behind one header so the final answer leads.
export function WorkedRollup({ durationMs, children }: WorkedRollupProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  // Older messages persisted before duration tracking have no duration_ms.
  const label =
    durationMs != null && durationMs > 0 ? `Worked for ${formatDuration(durationMs)}` : 'Worked';

  return (
    <div className={styles['worked-rollup']}>
      <Button
        type="button"
        variant="unstyled"
        onClick={() => setIsExpanded((prev) => !prev)}
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
