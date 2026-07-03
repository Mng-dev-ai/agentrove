import { memo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { FileIcon } from '@/components/ui/shared/FileIcon';
import { getFileName } from '@/utils/file';
import type { EditorCodeSelection } from '@/store/uiStore';

interface SelectionAttachmentsProps {
  selections: EditorCodeSelection[];
  onRemove: (index: number) => void;
}

export const SelectionAttachments = memo(function SelectionAttachments({
  selections,
  onRemove,
}: SelectionAttachmentsProps) {
  if (selections.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2">
      {selections.map((selection, index) => (
        <div
          // Duplicate chips of the same range are allowed, so the index keys them apart.
          key={`${selection.path}:${selection.startLine}:${index}`}
          title={selection.comment ? `${selection.path}\n\n${selection.comment}` : selection.path}
          className="flex items-center gap-1 rounded-md border border-border/50 bg-surface-tertiary py-0.5 pl-1.5 pr-0.5 dark:border-border-dark/50 dark:bg-surface-dark-tertiary"
        >
          <FileIcon name={getFileName(selection.path)} className="h-3 w-3" />
          <span className="font-mono text-2xs text-text-secondary dark:text-text-dark-secondary">
            {getFileName(selection.path)}:
            {selection.startLine === selection.endLine
              ? selection.startLine
              : `${selection.startLine}-${selection.endLine}`}
          </span>
          <Button
            type="button"
            variant="unstyled"
            onClick={() => onRemove(index)}
            className="rounded p-0.5 text-text-quaternary transition-colors duration-200 hover:text-text-primary dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
            aria-label="Remove code selection"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
});
