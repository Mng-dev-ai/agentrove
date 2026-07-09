import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { formatDuration } from '@/utils/date';

interface WorkedRollupProps {
  durationMs: number | null;
  children: React.ReactNode;
}

// Collapses the tool/thinking trace of a completed turn behind a single header,
// so the transcript leads with the final answer and the work expands on demand.
export const WorkedRollup: React.FC<WorkedRollupProps> = ({ durationMs, children }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  // Older messages persisted before duration tracking have no duration_ms.
  const label =
    durationMs != null && durationMs > 0 ? `Worked for ${formatDuration(durationMs)}` : 'Worked';

  return (
    <div className="mb-2">
      <Button
        type="button"
        variant="unstyled"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="group/button flex items-center gap-1 px-0 py-0.5 text-xs font-medium text-text-tertiary transition-colors duration-200 hover:text-text-primary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
      >
        <span>{label}</span>
        {/* Disclosure chevron: points right when collapsed, rotates down when open. */}
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform duration-300 ease-out group-hover/button:text-text-primary dark:group-hover/button:text-text-dark-primary ${isExpanded ? 'rotate-90' : ''}`}
        />
      </Button>
      {isExpanded && <div className="mt-1 animate-fade-in">{children}</div>}
    </div>
  );
};
