import type { ReactNode } from 'react';
import { Button } from '../primitives/Button/Button';
import styles from './CommandMenu.module.scss';

interface CommandMenuSubmodeProps {
  label: string;
  onBack: () => void;
  children: ReactNode;
}

export function CommandMenuSubmode({ label, onBack, children }: CommandMenuSubmodeProps) {
  return (
    <>
      <div className={styles['submode-header']}>
        <Button
          variant="unstyled"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onBack}
          className={styles['submode-back']}
        >
          {label}
        </Button>
        <span className={styles['submode-hint']}>Esc to go back</span>
      </div>
      <div className={styles['submode-panel']}>{children}</div>
    </>
  );
}
