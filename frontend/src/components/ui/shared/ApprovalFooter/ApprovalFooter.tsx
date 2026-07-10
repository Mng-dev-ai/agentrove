import clsx from 'clsx';
import { AlertCircle, Check, CheckCircle, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import type { PermissionOption } from '@/types/chat.types';
import styles from './ApprovalFooter.module.scss';

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
    <div className={styles['approval-footer']}>
      {error && (
        <div className={styles.error}>
          <AlertCircle className={styles['error-icon']} />
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

      {sortedAllow.length > 0 && sortedReject.length > 0 && <div className={styles.divider} />}

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
    <div className={styles['group-label']}>
      <Icon className={styles['group-label-icon']} />
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
    <FloatingTooltip content={option.name} className={styles['tooltip-wrap']}>
      <Button
        variant="unstyled"
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={clsx(styles['option-row'], isPrimary && styles['option-row--primary'])}
      >
        <div
          className={clsx(
            styles['option-icon-wrap'],
            isPrimary && styles['option-icon-wrap--primary'],
          )}
        >
          <Icon
            className={clsx(styles['option-icon'], isPrimary && styles['option-icon--primary'])}
          />
        </div>
        <div className={styles['option-content']}>
          <div
            className={clsx(
              styles['option-title'],
              !isPrimary && styles['option-title--secondary'],
            )}
          >
            {option.name}
          </div>
          <div
            className={clsx(
              styles['option-subtitle'],
              isPrimary ? styles['option-subtitle--primary'] : styles['option-subtitle--secondary'],
            )}
          >
            {subtitle}
          </div>
        </div>
      </Button>
    </FloatingTooltip>
  );
}
