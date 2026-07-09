import { Button } from '@/components/ui/primitives/Button/Button';

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
      className={
        bordered
          ? 'flex justify-end gap-2 border-t border-border px-5 py-3 dark:border-border-dark'
          : 'mt-5 flex justify-end gap-2'
      }
    >
      <Button onClick={onCancel} variant="outline" size="sm" disabled={saving}>
        Cancel
      </Button>
      <Button
        onClick={onSave}
        variant="outline"
        size="sm"
        className="border-text-primary bg-text-primary text-surface hover:bg-text-secondary dark:border-text-dark-primary dark:bg-text-dark-primary dark:text-surface-dark dark:hover:bg-text-dark-secondary"
        isLoading={saving}
        disabled={disabled}
      >
        {saveLabel}
      </Button>
    </div>
  );
}
