import { JSX } from 'react';
import clsx from 'clsx';
import { Check, Circle, X } from 'lucide-react';
import type { ToolEventStatus } from '@/types/tools.types';
import styles from './statusIndicator.module.scss';

export const statusIndicator: Record<ToolEventStatus, JSX.Element> = {
  completed: <Check className={clsx(styles.icon, styles['icon--completed'])} />,
  failed: <X className={clsx(styles.icon, styles['icon--failed'])} />,
  started: <Circle className={clsx(styles.icon, styles['icon--started'])} />,
};
