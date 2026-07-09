import { AlertTriangle } from 'lucide-react';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './ConfirmDialog.module.scss';

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
      <div className={styles.body}>
        <div className={styles.row}>
          <div className={styles['icon-badge']}>
            <AlertTriangle className={styles.icon} />
          </div>
          <div className={styles.text}>
            <h2 className={styles.title}>{title}</h2>
            <p className={styles.message}>{message}</p>
          </div>
        </div>
      </div>
      <div className={styles.footer}>
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
