import { memo } from 'react';
import clsx from 'clsx';
import { Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './SaveButton.module.scss';

export interface SaveButtonProps {
  isSaving: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export const SaveButton = memo(function SaveButton({
  isSaving,
  onClick,
  disabled,
  className,
}: SaveButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled || isSaving}
      variant="unstyled"
      className={clsx(styles['save-button'], isSaving && styles['save-button--saving'], className)}
    >
      {isSaving ? (
        <Loader2 className={clsx(styles.icon, styles['icon--spin'])} />
      ) : (
        <Save className={styles.icon} />
      )}
      {isSaving ? 'Saving' : 'Save'}
    </Button>
  );
});
