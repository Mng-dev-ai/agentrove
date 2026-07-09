import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './DialogFooter.module.scss';

interface DialogFooterProps {
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
  saving?: boolean;
  disabled?: boolean;
  bordered?: boolean;
}

export function DialogFooter({
  onCancel,
  onSave,
  saveLabel,
  saving,
  disabled,
  bordered = false,
}: DialogFooterProps) {
  return (
    <div
      className={clsx(
        styles['dialog-footer'],
        bordered ? styles['dialog-footer--bordered'] : styles['dialog-footer--plain'],
      )}
    >
      <Button onClick={onCancel} variant="outline" size="sm" disabled={saving}>
        Cancel
      </Button>
      <Button
        onClick={onSave}
        variant="outline"
        size="sm"
        className={styles['save-button']}
        isLoading={saving}
        disabled={disabled}
      >
        {saveLabel}
      </Button>
    </div>
  );
}
