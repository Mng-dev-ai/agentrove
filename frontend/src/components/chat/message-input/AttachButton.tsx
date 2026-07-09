import { Image } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './AttachButton.module.scss';

export interface AttachButtonProps {
  onAttach?: () => void;
  disabled?: boolean;
}

export function AttachButton({ onAttach, disabled = false }: AttachButtonProps) {
  return (
    <Button
      type="button"
      onClick={onAttach}
      variant="unstyled"
      disabled={disabled}
      className={styles['attach-button']}
      aria-label="Attach file"
    >
      <Image className={styles.icon} />
    </Button>
  );
}
