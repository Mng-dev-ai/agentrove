import { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './ModalHeader.module.scss';

export interface ModalHeaderProps {
  title: string;
  onClose: () => void;
  actions?: ReactNode;
}

export function ModalHeader({ title, onClose, actions }: ModalHeaderProps) {
  return (
    <div className={styles['modal-header']}>
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.actions}>
        {actions}
        <Button
          onClick={onClose}
          variant="unstyled"
          className={styles['close-button']}
          aria-label="Close modal"
        >
          <X className={styles['close-icon']} />
        </Button>
      </div>
    </div>
  );
}
