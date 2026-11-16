import { X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './ModalHeader.module.scss';

export interface ModalHeaderProps {
  title: string;
  description?: string;
  onClose: () => void;
}

export function ModalHeader({ title, description, onClose }: ModalHeaderProps) {
  return (
    <div className={styles['modal-header']}>
      <div className={styles.text}>
        <h3 className={styles.title}>{title}</h3>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      <Button
        onClick={onClose}
        variant="unstyled"
        className={styles['close-button']}
        aria-label="Close modal"
      >
        <X className={styles['close-icon']} />
      </Button>
    </div>
  );
}
