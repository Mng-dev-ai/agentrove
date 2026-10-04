import type { DragEvent, FormEvent, ReactNode, Ref } from 'react';
import clsx from 'clsx';
import { stateClasses } from '@/config/stateClasses';
import styles from './ComposerField.module.scss';

interface ComposerFieldProps {
  ref?: Ref<HTMLFormElement>;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  textarea: ReactNode;
  actions: ReactNode;
  attachments?: ReactNode;
  isDragging?: boolean;
  dragHandlers?: Record<string, (e: DragEvent<HTMLElement>) => void>;
  children?: ReactNode;
}

export function ComposerField({
  ref,
  onSubmit,
  textarea,
  actions,
  attachments,
  isDragging = false,
  dragHandlers,
  children,
}: ComposerFieldProps) {
  return (
    <form ref={ref} onSubmit={onSubmit} className={styles.composer}>
      <div {...dragHandlers} className={clsx(styles.field, isDragging && stateClasses.DRAGGING)}>
        {attachments}
        <div className={styles['textarea-wrap']}>{textarea}</div>
        <div className={styles.actions}>{actions}</div>
      </div>
      {children}
    </form>
  );
}
