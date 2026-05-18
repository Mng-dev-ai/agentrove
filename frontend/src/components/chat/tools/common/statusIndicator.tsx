import { JSX } from 'react';
import { Check, Circle, X } from 'lucide-react';
import type { ToolEventStatus } from '@/types/tools.types';

export const statusIndicator: Record<ToolEventStatus, JSX.Element> = {
  completed: <Check className="h-3 w-3 text-success-600 dark:text-success-400" />,
  failed: <X className="h-3 w-3 text-error-600 dark:text-error-400" />,
  started: (
    <Circle className="h-3 w-3 animate-pulse text-text-quaternary dark:text-text-dark-quaternary" />
  ),
};
