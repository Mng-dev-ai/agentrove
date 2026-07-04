import React, { memo, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { ChevronRight } from 'lucide-react';
import type { ToolEventStatus } from '@/types/tools.types';
import { TOOL_ERROR_PRE_CLASS } from '@/utils/toolStyles';
import { statusIndicator } from './statusIndicator';

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

const ToolCardInner: React.FC<ToolCardProps> = ({
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
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const resolvedTitle = typeof title === 'function' ? title(status) : title;

  const hasDetailsError = status === 'failed' && error;
  const hasExpandableContent = Boolean(children) || Boolean(hasDetailsError);
  const showChildren = !hasExpandableContent || expanded;
  const details =
    children || hasDetailsError ? (
      <div className="mt-1.5 space-y-1.5">
        {children}
        {hasDetailsError &&
          (React.isValidElement(error) ? (
            error
          ) : (
            // Multiline error output belongs inside the collapsible body alongside normal results
            <pre className={TOOL_ERROR_PRE_CLASS}>{error}</pre>
          ))}
      </div>
    ) : null;

  const header = (
    <div className="flex items-center gap-1.5">
      <div className="flex-shrink-0 text-text-quaternary dark:text-text-dark-quaternary">
        {icon}
      </div>
      <FloatingTooltip content={resolvedTitle} className="min-w-0">
        <span className="block max-w-md truncate text-2xs text-text-tertiary dark:text-text-dark-tertiary">
          {resolvedTitle}
        </span>
      </FloatingTooltip>
      {statusIndicator[status]}
      {hasExpandableContent && (
        <ChevronRight
          className={`h-3 w-3 text-text-quaternary transition-transform duration-200 dark:text-text-dark-quaternary ${expanded ? 'rotate-90' : ''}`}
        />
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
          <p className="mt-0.5 pl-5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            {loadingContent}
          </p>
        ))}
      {statusDetail &&
        (React.isValidElement(statusDetail) ? (
          statusDetail
        ) : (
          <p className="mt-0.5 pl-5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            {statusDetail}
          </p>
        ))}
    </>
  );

  return (
    <div className={`group/tool ${className}`}>
      <div className="flex items-center gap-1">
        {hasExpandableContent ? (
          <Button
            variant="unstyled"
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="-ml-1 rounded-md px-1 py-0.5 text-left transition-colors duration-150 hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
            aria-expanded={expanded}
          >
            {header}
          </Button>
        ) : (
          <div className="-ml-1 px-1 py-0.5">{header}</div>
        )}
        {actions}
      </div>
      {meta}
      {showChildren && details}
    </div>
  );
};

export const ToolCard = memo(ToolCardInner);
