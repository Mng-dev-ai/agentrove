import { JSX } from 'react';
import clsx from 'clsx';
import { Circle, X } from 'lucide-react';
import type { ToolEventStatus } from '@/types/tools.types';
import styles from './statusIndicator.module.scss';

export const statusIndicator: Record<ToolEventStatus, JSX.Element | null> = {
  completed: null,
  failed: <X className={clsx(styles.icon, styles['icon--failed'])} />,
  started: <Circle className={clsx(styles.icon, styles['icon--started'])} />,
};
