import { memo } from 'react';
import clsx from 'clsx';
import { TextQuote, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { FileIcon } from '@/components/ui/shared/FileIcon/FileIcon';
import { getFileName } from '@/utils/file';
import type { ComposerSelection } from '@/store/uiStore';
import styles from './SelectionAttachments.module.scss';

interface SelectionAttachmentsProps {
  selections: ComposerSelection[];
  onRemove: (index: number) => void;
}

export const SelectionAttachments = memo(function SelectionAttachments({
  selections,
  onRemove,
}: SelectionAttachmentsProps) {
  if (selections.length === 0) return null;

  return (
    <div className={styles['selection-attachments']}>
      {selections.map((selection, index) => {
        const isChatText = 'kind' in selection;
        return (
          <FloatingTooltip
            // Duplicate chips of the same range are allowed, so the index keys them apart.
            key={isChatText ? `chat:${index}` : `${selection.path}:${selection.startLine}:${index}`}
            content={
              isChatText
                ? selection.text
                : selection.comment
                  ? `${selection.path}\n\n${selection.comment}`
                  : selection.path
            }
            className={styles.chip}
          >
            {isChatText ? (
              <>
                <TextQuote className={styles['file-icon']} />
                <span className={clsx(styles.label, styles['label--text'])}>{selection.text}</span>
              </>
            ) : (
              <>
                <FileIcon name={getFileName(selection.path)} className={styles['file-icon']} />
                <span className={styles.label}>
                  {getFileName(selection.path)}:
                  {selection.startLine === selection.endLine
                    ? selection.startLine
                    : `${selection.startLine}-${selection.endLine}`}
                </span>
              </>
            )}
            <Button
              type="button"
              variant="unstyled"
              onClick={() => onRemove(index)}
              className={styles.remove}
              aria-label="Remove selection"
            >
              <X className={styles['remove-icon']} />
            </Button>
          </FloatingTooltip>
        );
      })}
    </div>
  );
});
