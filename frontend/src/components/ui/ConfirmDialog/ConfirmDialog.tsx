import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { ModalHeader } from '@/components/ui/shared/ModalHeader/ModalHeader';
import { DialogFooter } from '@/components/ui/shared/DialogFooter/DialogFooter';
import styles from './ConfirmDialog.module.scss';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="sm">
      <ModalHeader title={title} onClose={onClose} />
      <p className={styles.message}>{message}</p>
      <DialogFooter
        onCancel={onClose}
        onSave={() => {
          onConfirm();
          onClose();
        }}
        saveLabel={confirmLabel}
        cancelLabel={cancelLabel}
        destructive={destructive}
      />
    </BaseModal>
  );
}
