import { AlertTriangle } from 'lucide-react';
import { BaseModal } from './shared/BaseModal';
import { Button } from './primitives/Button/Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="sm" zIndex="modalHighest">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
            <AlertTriangle className="h-4 w-4 text-text-tertiary dark:text-text-dark-tertiary" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              {title}
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-text-secondary dark:text-text-dark-secondary">
              {message}
            </p>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border/50 px-5 py-3.5 dark:border-border-dark/50">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </BaseModal>
  );
}
