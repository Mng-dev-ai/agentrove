import { AlertCircle, Check, CheckCircle, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { cn } from '@/utils/cn';
import type { PermissionOption } from '@/types/chat.types';

// Generic, agent-agnostic subtitles keyed by option kind — reinforces the
// server-provided title with a plain-English outcome line.
const KIND_SUBTITLES: Record<PermissionOption['kind'], string> = {
  allow_once: 'Proceed with this request.',
  allow_always: "Allow and don't ask again.",
  reject_once: 'Reject this request.',
  reject_always: "Reject and don't ask again.",
};

const ALLOW_PRIORITY: PermissionOption['kind'][] = ['allow_once', 'allow_always'];
const REJECT_PRIORITY: PermissionOption['kind'][] = ['reject_once', 'reject_always'];

interface PermissionApprovalButtonsProps {
  allowOptions: PermissionOption[];
  rejectOptions: PermissionOption[];
  onApprove: (optionId: string) => void;
  onReject: (optionId: string) => void;
  isLoading: boolean;
  error: string | null;
}

export function PermissionApprovalButtons({
  allowOptions,
  rejectOptions,
  onApprove,
  onReject,
  isLoading,
  error,
}: PermissionApprovalButtonsProps) {
  const sortedAllow = sortByPriority(allowOptions, ALLOW_PRIORITY);
  const sortedReject = sortByPriority(rejectOptions, REJECT_PRIORITY);
  // Only show "Allow" / "Reject" group labels when the user has to choose
  // between multiple options in a group; a single-option footer (e.g. plan
  // mode) doesn't need the extra visual grouping.
  const showGroupLabels = sortedAllow.length + sortedReject.length > 2;
  const primaryAllowId = sortedAllow[0]?.option_id ?? null;

  return (
    <div className="border-t border-border/50 p-2 dark:border-border-dark/50">
      {error && (
        <div className="mb-2 flex items-center gap-2 px-1 text-2xs text-error-600 dark:text-error-400">
          <AlertCircle className="h-3 w-3 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {sortedAllow.length > 0 && (
        <>
          {showGroupLabels && <GroupLabel kind="allow" />}
          {sortedAllow.map((opt) => (
            <OptionRow
              key={opt.option_id}
              option={opt}
              isPrimary={opt.option_id === primaryAllowId}
              onClick={() => onApprove(opt.option_id)}
              disabled={isLoading}
            />
          ))}
        </>
      )}

      {sortedAllow.length > 0 && sortedReject.length > 0 && (
        <div className="mx-2 my-1 h-px bg-border/50 dark:bg-border-dark/50" />
      )}

      {sortedReject.length > 0 && (
        <>
          {showGroupLabels && <GroupLabel kind="reject" />}
          {sortedReject.map((opt) => (
            <OptionRow
              key={opt.option_id}
              option={opt}
              isPrimary={false}
              onClick={() => onReject(opt.option_id)}
              disabled={isLoading}
            />
          ))}
        </>
      )}
    </div>
  );
}

function sortByPriority(
  options: PermissionOption[],
  priority: PermissionOption['kind'][],
): PermissionOption[] {
  return [...options].sort((a, b) => {
    const ai = priority.indexOf(a.kind);
    const bi = priority.indexOf(b.kind);
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });
}

interface GroupLabelProps {
  kind: 'allow' | 'reject';
}

function GroupLabel({ kind }: GroupLabelProps) {
  const Icon = kind === 'allow' ? Check : X;
  return (
    <div className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
      <Icon className="h-2.5 w-2.5" />
      {kind === 'allow' ? 'Allow' : 'Reject'}
    </div>
  );
}

interface OptionRowProps {
  option: PermissionOption;
  isPrimary: boolean;
  onClick: () => void;
  disabled: boolean;
}

function OptionRow({ option, isPrimary, onClick, disabled }: OptionRowProps) {
  const Icon = option.kind.startsWith('allow') ? CheckCircle : XCircle;
  const subtitle = KIND_SUBTITLES[option.kind];

  return (
    <FloatingTooltip content={option.name} className="w-full">
      <Button
        variant="unstyled"
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'mb-0.5 flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
          isPrimary
            ? 'border-text-primary bg-text-primary text-surface hover:bg-text-secondary dark:border-text-dark-primary dark:bg-text-dark-primary dark:text-surface-dark dark:hover:bg-text-dark-secondary'
            : 'border-transparent hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
        )}
      >
        <div
          className={cn(
            'mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md',
            isPrimary ? 'bg-white/10 dark:bg-black/10' : 'bg-black/5 dark:bg-white/5',
          )}
        >
          <Icon
            className={cn(
              'h-3.5 w-3.5',
              isPrimary
                ? 'text-surface dark:text-surface-dark'
                : 'text-text-tertiary dark:text-text-dark-tertiary',
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'text-xs font-medium leading-snug',
              !isPrimary && 'text-text-primary dark:text-text-dark-primary',
            )}
          >
            {option.name}
          </div>
          <div
            className={cn(
              'mt-0.5 text-2xs leading-snug',
              isPrimary
                ? 'text-surface/60 dark:text-surface-dark/60'
                : 'text-text-tertiary dark:text-text-dark-tertiary',
            )}
          >
            {subtitle}
          </div>
        </div>
      </Button>
    </FloatingTooltip>
  );
}
