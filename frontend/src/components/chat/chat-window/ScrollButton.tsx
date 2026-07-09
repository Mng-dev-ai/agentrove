import { memo } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './ScrollButton.module.scss';

interface ScrollButtonProps {
  onClick: () => void;
}

export const ScrollButton = memo(function ScrollButton({ onClick }: ScrollButtonProps) {
  return (
    <div className={styles['scroll-button-slot']}>
      <Button
        onClick={onClick}
        variant="unstyled"
        className={styles['scroll-button']}
        aria-label="Scroll to bottom"
      >
        <ChevronDown className={styles['scroll-icon']} />
      </Button>
    </div>
  );
});
