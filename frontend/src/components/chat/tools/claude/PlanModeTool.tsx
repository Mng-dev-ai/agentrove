import { memo } from 'react';
import { Map, Terminal } from 'lucide-react';
import { LazyMarkDown } from '@/components/ui/LazyMarkDown';
import type { ToolAggregate } from '@/types/tools.types';
import { MessageActions } from '../../message-bubble/MessageActions';
import { PermissionApprovalButtons } from '@/components/ui/shared/ApprovalFooter';
import { filterOptions } from '@/utils/permissionStorage';
import { ToolCard } from '../common/ToolCard';
import { useExitPlanMode } from '@/hooks/useExitPlanMode';

interface PlanModeToolProps {
  tool: ToolAggregate;
  chatId?: string;
}

interface AllowedPrompt {
  tool: string;
  prompt: string;
}

const EnterPlanModeInner: React.FC<PlanModeToolProps> = ({ tool }) => (
  <ToolCard
    icon={<Map className="h-3.5 w-3.5 text-text-secondary dark:text-text-dark-tertiary" />}
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
    loadingContent="Entering plan mode\u2026"
    error={tool.error}
  />
);

const ExitPlanModeInner: React.FC<PlanModeToolProps> = ({ tool, chatId }) => {
  const { pendingRequest, isLoading, error, handleApprove, handleReject } = useExitPlanMode(chatId);

  const planContent = tool.input?.plan as string | undefined;
  const copyId = `plan-${tool.id}`;
  const allowedPrompts = (tool.input?.allowedPrompts ?? []) as AllowedPrompt[];

  if (pendingRequest) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-surface-tertiary dark:border-border-dark dark:bg-surface-dark-tertiary">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 dark:border-border-dark">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-black/5 p-1 dark:bg-white/5">
              <Map className="h-3.5 w-3.5 text-text-tertiary dark:text-text-dark-tertiary" />
            </div>
            <span className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
              Plan Approval
            </span>
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

        <div className="max-h-[50vh] overflow-y-auto p-3">
          <p className="text-xs text-text-secondary dark:text-text-dark-secondary">
            The assistant has finished planning and is ready to begin implementation.
          </p>

          {planContent && (
            <div className="mt-3 overflow-auto rounded-md bg-black/5 px-2 py-1.5 text-xs dark:bg-white/5">
              <div className="prose prose-sm dark:prose-invert max-w-none text-text-primary dark:text-text-dark-primary">
                <LazyMarkDown content={planContent} />
              </div>
            </div>
          )}

          {allowedPrompts.length > 0 && (
            <div className="mt-3">
              <p className="text-2xs font-medium uppercase tracking-wide text-text-tertiary dark:text-text-dark-tertiary">
                Requested Permissions
              </p>
              <div className="mt-1.5 space-y-1">
                {allowedPrompts.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 dark:bg-white/5"
                  >
                    <Terminal className="h-3 w-3 flex-shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
                    <span className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      {item.prompt}
                    </span>
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
      icon={<Map className="h-3.5 w-3.5 text-text-secondary dark:text-text-dark-tertiary" />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return 'Plan approved';
          case 'failed':
            return 'Plan rejected';
          default:
            return 'Waiting for plan approval\u2026';
        }
      }}
      loadingContent="Waiting for plan approval\u2026"
      error={tool.error}
    >
      {hasContent && (
        <div className="space-y-2">
          {planContent && (
            <div className="overflow-auto rounded-md bg-black/5 px-2 py-1.5 text-xs dark:bg-white/5">
              <div className="prose prose-sm dark:prose-invert max-w-none text-text-primary dark:text-text-dark-primary">
                <LazyMarkDown content={planContent} />
              </div>
            </div>
          )}
          {allowedPrompts.length > 0 && (
            <div>
              <p className="text-2xs font-medium uppercase tracking-wide text-text-tertiary dark:text-text-dark-tertiary">
                Requested Permissions
              </p>
              <div className="mt-1.5 space-y-1">
                {allowedPrompts.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 dark:bg-white/5"
                  >
                    <Terminal className="h-3 w-3 flex-shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
                    <span className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      {item.prompt}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </ToolCard>
  );
};

export const EnterPlanModeTool = memo(EnterPlanModeInner);
export const ExitPlanModeTool = memo(ExitPlanModeInner);
