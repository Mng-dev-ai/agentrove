import { memo } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from '../common/ToolCard/ToolCard';
import styles from './GuardianReviewTool.module.scss';

// Codex Guardian auto-approval review, mapped by codex-acp as ACP kind "think".
// Both raw_input (start) and raw_output (completion) carry the full review event.
interface GuardianReviewEvent {
  review?: {
    status?: string;
    riskLevel?: string;
    rationale?: string;
    userAuthorization?: string;
  };
  action?: {
    type?: string;
    command?: string;
    argv?: string[];
    program?: string;
    files?: string[];
    host?: string;
    target?: string;
    server?: string;
    toolName?: string;
    connectorName?: string;
    reason?: string;
  };
}

const REVIEW_VERDICTS: Record<string, string> = {
  inProgress: 'reviewing',
  approved: 'approved',
  denied: 'denied',
  aborted: 'aborted',
  timedOut: 'timed out',
};

function actionSummary(action: GuardianReviewEvent['action']): string {
  switch (action?.type) {
    case 'command':
      return action.command ?? '';
    case 'execve':
      return action.argv?.length ? action.argv.join(' ') : (action.program ?? '');
    case 'applyPatch':
      return action.files?.length === 1
        ? `apply_patch touching ${action.files[0]}`
        : `apply_patch touching ${action.files?.length ?? 0} files`;
    case 'networkAccess':
      return `network access to ${action.target || action.host || 'unknown host'}`;
    case 'mcpToolCall':
      return `MCP ${action.toolName ?? ''} on ${action.connectorName ?? action.server ?? ''}`;
    case 'requestPermissions':
      return action.reason ?? 'request additional permissions';
    default:
      return '';
  }
}

export const GuardianReviewTool = memo(function GuardianReviewTool({
  tool,
}: {
  tool: ToolAggregate;
}) {
  // The completion event (result) has the final verdict; fall back to the
  // start event (input) while the review is still running.
  const event = (tool.result ?? tool.input ?? {}) as GuardianReviewEvent;
  const review = event.review;
  const verdict = REVIEW_VERDICTS[review?.status ?? ''] ?? review?.status ?? '';
  const action = actionSummary(event.action);

  const rows = [
    action && { label: 'Action', value: action },
    review?.riskLevel && { label: 'Risk', value: review.riskLevel },
    review?.rationale?.trim() && { label: 'Rationale', value: review.rationale },
    review?.userAuthorization && { label: 'Authorization', value: review.userAuthorization },
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  return (
    <ToolCard
      icon={<ShieldCheck className={styles.icon} />}
      status={tool.status}
      title={(status) =>
        status === 'started' ? 'Guardian review' : `Guardian review${verdict ? `: ${verdict}` : ''}`
      }
      // No error prop: a denied review is a verdict, not a failure — the
      // structured body replaces ToolCard's error dump of the raw event.
      loadingContent="Reviewing action..."
    >
      {rows.length > 0 && (
        <div className={styles.body}>
          {rows.map((row) => (
            <div key={row.label} className={styles.row}>
              <span className={styles['row-label']}>{row.label}</span>
              <span className={styles['row-value']}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </ToolCard>
  );
});
