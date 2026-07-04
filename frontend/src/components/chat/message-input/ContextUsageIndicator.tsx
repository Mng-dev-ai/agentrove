import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { formatNumberCompact } from '@/utils/format';

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
      ? 'text-error-500 dark:text-error-400'
      : percentage >= 75
        ? 'text-warning-500 dark:text-warning-400'
        : 'text-text-primary dark:text-text-dark-primary';

  const tooltip = `${formatNumberCompact(usage.tokensUsed)}/${formatNumberCompact(usage.contextWindow)}`;

  return (
    <FloatingTooltip
      content={tooltip}
      className="flex select-none items-center gap-1 text-2xs text-text-secondary dark:text-text-dark-secondary"
    >
      <span className="font-medium tabular-nums">{formattedPercentage}%</span>
      <svg viewBox="0 0 24 24" className="h-5 w-5" role="presentation" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          strokeWidth="2"
          stroke="currentColor"
          className="text-border dark:text-border-dark"
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
