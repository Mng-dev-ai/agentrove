import clsx from 'clsx';
import type { MachineStatus } from '@/types/machine.types';
import styles from './MachineStatusDot.module.scss';

export function MachineStatusDot({
  status,
  className,
}: {
  status: MachineStatus;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={clsx(styles.dot, styles[`dot--${status.replace('_', '-')}`], className)}
    />
  );
}
