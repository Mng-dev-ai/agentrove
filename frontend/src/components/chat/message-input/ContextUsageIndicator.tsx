import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { formatNumberCompact } from '@/utils/format';
import styles from './ContextUsageIndicator.module.scss';

export interface ContextUsageInfo {
  tokensUsed: number;
  contextWindow: number;
}

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export const ContextUsageIndicator = ({ usage }: { usage: ContextUsageInfo }) => {
  const percentage =
    usage.contextWindow > 0 ? Math.min((usage.tokensUsed / usage.contextWindow) * 100, 100) : 0;

  const formattedPercentage =
    percentage === 0
      ? '0'
      : percentage >= 10
        ? percentage.toFixed(0)
        : percentage >= 1
          ? percentage.toFixed(1)
          : percentage.toFixed(2);
  const dashOffset = CIRCUMFERENCE * (1 - percentage / 100);

  const progressClass =
    percentage >= 95
      ? styles['ring-progress--danger']
      : percentage >= 75
        ? styles['ring-progress--warning']
        : styles['ring-progress--normal'];

  const tooltip = `${formatNumberCompact(usage.tokensUsed)}/${formatNumberCompact(usage.contextWindow)}`;

  return (
    <FloatingTooltip content={tooltip} className={styles['context-usage']}>
      <span className={styles.value}>{formattedPercentage}%</span>
      <svg viewBox="0 0 24 24" className={styles.ring} role="presentation" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          strokeWidth="2"
          stroke="currentColor"
          className={styles['ring-track']}
          fill="none"
        />
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          strokeWidth="2"
          stroke="currentColor"
          className={progressClass}
          fill="none"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 12 12)"
        />
      </svg>
    </FloatingTooltip>
  );
};
