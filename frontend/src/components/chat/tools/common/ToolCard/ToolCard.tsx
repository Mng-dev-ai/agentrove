import React, { memo, useState } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ChevronRight } from 'lucide-react';
import type { ToolEventStatus } from '@/types/tools.types';
import { statusIndicator } from '../statusIndicator';
import toolText from '../toolText.module.scss';
import styles from './ToolCard.module.scss';

type ToolCardTitle = string | ((status: ToolEventStatus) => string);

type Content = React.ReactNode | string | null | undefined;

interface ToolCardProps {
  icon: React.ReactNode;
  status: ToolEventStatus;
  title: ToolCardTitle;
  actions?: React.ReactNode;
  loadingContent?: Content;
  error?: Content;
  statusDetail?: Content;
  children?: React.ReactNode;
  className?: string;
  defaultExpanded?: boolean;
}

export const ToolCard = memo(function ToolCard({
  icon,
  status,
  title,
  actions,
  loadingContent,
  error,
  statusDetail,
  children,
  className = '',
  defaultExpanded = false,
}: ToolCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const resolvedTitle = typeof title === 'function' ? title(status) : title;

  const hasDetailsError = status === 'failed' && error;
  const hasExpandableContent = Boolean(children) || Boolean(hasDetailsError);
  const showChildren = !hasExpandableContent || expanded;
  const details =
    children || hasDetailsError ? (
      <div className={styles.details}>
        {children}
        {hasDetailsError &&
          (React.isValidElement(error) ? (
            error
          ) : (
            <pre className={toolText['error-pre']}>{error}</pre>
          ))}
      </div>
    ) : null;

  const header = (
    <div className={styles.header}>
      <div className={styles['icon-wrap']}>{icon}</div>
      <FloatingTooltip content={resolvedTitle} className={styles['tooltip-wrap']}>
        <span className={styles.title}>{resolvedTitle}</span>
      </FloatingTooltip>
      {statusIndicator[status]}
      {hasExpandableContent && (
        <ChevronRight className={clsx(styles.chevron, expanded && styles['chevron--expanded'])} />
      )}
    </div>
  );

  const meta = (
    <>
      {status === 'started' &&
        loadingContent &&
        (React.isValidElement(loadingContent) ? (
          loadingContent
        ) : (
          <p className={styles.meta}>{loadingContent}</p>
        ))}
      {statusDetail &&
        (React.isValidElement(statusDetail) ? (
          statusDetail
        ) : (
          <p className={styles.meta}>{statusDetail}</p>
        ))}
    </>
  );

  return (
    // literal `tool-card` is a stable global hook so child actions (OpenInEditorButton,
    // AgentTool's open button) can reveal on card hover across module boundaries.
    <div className={clsx('tool-card', className)}>
      <div className={styles.row}>
        {hasExpandableContent ? (
          <Button
            variant="unstyled"
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className={styles.trigger}
            aria-expanded={expanded}
          >
            {header}
          </Button>
        ) : (
          <div className={styles.static}>{header}</div>
        )}
        {actions}
      </div>
      {meta}
      {showChildren && details}
    </div>
  );
});
