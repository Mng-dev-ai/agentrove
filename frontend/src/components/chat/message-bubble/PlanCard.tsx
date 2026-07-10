import { memo } from 'react';
import clsx from 'clsx';
import { ListTodo, CheckCircle2, Circle, Clock } from 'lucide-react';
import type { PlanEntry } from '@/types/chat.types';
import styles from './PlanCard.module.scss';

interface PlanCardProps {
  entries: PlanEntry[];
}

function getStatusIcon(status: PlanEntry['status']) {
  switch (status) {
    case 'completed':
      return (
        <CheckCircle2 className={clsx(styles['status-icon'], styles['status-icon--completed'])} />
      );
    case 'in_progress':
      return <Clock className={clsx(styles['status-icon'], styles['status-icon--in-progress'])} />;
    default:
      return <Circle className={clsx(styles['status-icon'], styles['status-icon--pending'])} />;
  }
}

export const PlanCard = memo(function PlanCard({ entries }: PlanCardProps) {
  // Not a ToolCard: a plan is live agent state, not a call with a terminal
  // status — no spinner/status chip, and the checklist stays visible.
  const completedCount = entries.filter((entry) => entry.status === 'completed').length;

  return (
    <div className={styles['plan-card']}>
      <div className={styles.header}>
        <ListTodo className={styles.icon} />
        <span className={styles.title}>Plan</span>
        <span className={styles.count}>
          {completedCount}/{entries.length}
        </span>
      </div>
      <div className={styles.list}>
        {entries.map((entry, index) => (
          <div key={`${index}-${entry.content}`} className={styles.row}>
            <div className={styles['status-icon-wrap']}>{getStatusIcon(entry.status)}</div>
            <p
              className={clsx(
                styles.label,
                entry.status === 'completed' && styles['label--completed'],
              )}
            >
              {entry.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
});
