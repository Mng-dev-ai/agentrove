import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './DialogFooter.module.scss';

interface DialogFooterProps {
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
  cancelLabel?: string;
  saving?: boolean;
  disabled?: boolean;
  destructive?: boolean;
}

export function DialogFooter({
  onCancel,
  onSave,
  saveLabel,
  cancelLabel = 'Cancel',
  saving,
  disabled,
  destructive,
}: DialogFooterProps) {
  return (
    <div className={styles['dialog-footer']}>
      <Button type="button" onClick={onCancel} variant="ghost" size="sm" disabled={saving}>
        {cancelLabel}
      </Button>
      <Button
        type="button"
        onClick={onSave}
        variant={destructive ? 'destructive' : 'primary'}
        size="sm"
        isLoading={saving}
        disabled={disabled}
      >
        {saveLabel}
      </Button>
    </div>
  );
}
