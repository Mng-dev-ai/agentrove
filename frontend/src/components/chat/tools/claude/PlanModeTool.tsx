import { memo } from 'react';
import clsx from 'clsx';
import { Map, Terminal } from 'lucide-react';
import { MarkDown } from '@/components/ui/markdown/MarkDown';
import type { ToolAggregate } from '@/types/tools.types';
import { MessageActions } from '../../message-bubble/MessageActions';
import { PermissionApprovalButtons } from '@/components/ui/shared/ApprovalFooter/ApprovalFooter';
import { filterOptions } from '@/utils/permissionStorage';
import { ToolCard } from '../common/ToolCard/ToolCard';
import { useExitPlanMode } from '@/hooks/useExitPlanMode';
import toolIcon from './toolIcon.module.scss';
import styles from './PlanModeTool.module.scss';

interface PlanModeToolProps {
  tool: ToolAggregate;
  chatId?: string;
}

interface AllowedPrompt {
  tool: string;
  prompt: string;
}

export const EnterPlanModeTool = memo(function EnterPlanModeTool({ tool }: PlanModeToolProps) {
  return (
    <ToolCard
      icon={<Map className={toolIcon.icon} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return 'Entered plan mode';
          case 'failed':
            return 'Failed to enter plan mode';
          default:
            return 'Entering plan mode';
        }
      }}
      loadingContent="Entering plan mode…"
      error={tool.error}
    />
  );
});

export const ExitPlanModeTool = memo(function ExitPlanModeTool({
  tool,
  chatId,
}: PlanModeToolProps) {
  const { pendingRequest, isLoading, error, handleApprove, handleReject } = useExitPlanMode(chatId);

  const planContent = tool.input?.plan as string | undefined;
  const copyId = `plan-${tool.id}`;
  const allowedPrompts = (tool.input?.allowedPrompts ?? []) as AllowedPrompt[];

  if (pendingRequest) {
    return (
      <div className={styles.card}>
        <div className={styles['card-header']}>
          <div className={styles['header-left']}>
            <div className={styles['icon-wrap']}>
              <Map className={styles['plan-icon']} />
            </div>
            <span className={styles.title}>Plan Approval</span>
          </div>
          {planContent && (
            <MessageActions
              messageId={copyId}
              contentText={planContent}
              copyLabel="Copy plan"
              showTooltip={false}
            />
          )}
        </div>

        <div className={styles['card-body']}>
          <p className={styles.description}>
            The assistant has finished planning and is ready to begin implementation.
          </p>

          {planContent && (
            <div className={clsx(styles['plan-box'], styles['plan-box--spaced'])}>
              <div className={styles['plan-prose']}>
                <MarkDown content={planContent} />
              </div>
            </div>
          )}

          {allowedPrompts.length > 0 && (
            <div className={styles['plan-box--spaced']}>
              <p className={styles['permissions-label']}>Requested Permissions</p>
              <div className={styles['permissions-list']}>
                {allowedPrompts.map((item, index) => (
                  <div key={index} className={styles['permission-item']}>
                    <Terminal className={styles['permission-icon']} />
                    <span className={styles['permission-text']}>{item.prompt}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <PermissionApprovalButtons
          allowOptions={filterOptions(pendingRequest.options, 'allow')}
          rejectOptions={filterOptions(pendingRequest.options, 'reject')}
          onApprove={handleApprove}
          onReject={handleReject}
          isLoading={isLoading}
          error={error}
        />
      </div>
    );
  }

  const hasContent = !!planContent || allowedPrompts.length > 0;

  return (
    <ToolCard
      icon={<Map className={toolIcon.icon} />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return 'Plan approved';
          case 'failed':
            return 'Plan rejected';
          default:
            return 'Waiting for plan approval…';
        }
      }}
      loadingContent="Waiting for plan approval…"
      error={tool.error}
    >
      {hasContent && (
        <div className={styles.stack}>
          {planContent && (
            <div className={styles['plan-box']}>
              <div className={styles['plan-prose']}>
                <MarkDown content={planContent} />
              </div>
            </div>
          )}
          {allowedPrompts.length > 0 && (
            <div>
              <p className={styles['permissions-label']}>Requested Permissions</p>
              <div className={styles['permissions-list']}>
                {allowedPrompts.map((item, index) => (
                  <div key={index} className={styles['permission-item']}>
                    <Terminal className={styles['permission-icon']} />
                    <span className={styles['permission-text']}>{item.prompt}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </ToolCard>
  );
});
