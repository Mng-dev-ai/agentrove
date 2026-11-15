import { useLayoutEffect, useRef, useState } from 'react';
import type { DragEvent, FormEvent, ReactNode, Ref } from 'react';
import clsx from 'clsx';
import { stateClasses } from '@/config/stateClasses';
import styles from './ComposerField.module.scss';

interface ComposerFieldProps {
  ref?: Ref<HTMLFormElement>;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  message: string;
  leading: ReactNode;
  textarea: ReactNode;
  trailing: ReactNode;
  attachments?: ReactNode;
  isDragging?: boolean;
  dragHandlers?: Record<string, (e: DragEvent<HTMLElement>) => void>;
  children?: ReactNode;
}

export function ComposerField({
  ref,
  onSubmit,
  message,
  leading,
  textarea,
  trailing,
  attachments,
  isDragging = false,
  dragHandlers,
  children,
}: ComposerFieldProps) {
  const probeRef = useRef<HTMLDivElement>(null);
  const probeTextRef = useRef<HTMLSpanElement>(null);
  const [multiline, setMultiline] = useState(false);

  // The probe sits in the middle grid column, which is the single-row text width in both
  // layouts, so the decision never depends on the layout it produces and cannot oscillate.
  useLayoutEffect(() => {
    const probe = probeRef.current;
    const probeText = probeTextRef.current;
    if (!probe || !probeText) return;
    const measure = () =>
      setMultiline(
        message.includes('\n') ||
          Math.ceil(probeText.getBoundingClientRect().width) >
            Math.floor(probe.getBoundingClientRect().width),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [message]);

  return (
    <form ref={ref} onSubmit={onSubmit} className={styles.composer}>
      <div {...dragHandlers} className={clsx(styles.field, isDragging && stateClasses.DRAGGING)}>
        {attachments}
        <div className={clsx(styles.row, multiline && styles['row--multiline'])}>
          <div className={styles.leading}>{leading}</div>
          <div className={styles.text}>{textarea}</div>
          <div className={styles.trailing}>{trailing}</div>
          <div ref={probeRef} aria-hidden className={styles.probe}>
            <span ref={probeTextRef}>{message}</span>
          </div>
        </div>
      </div>
      {children}
    </form>
  );
}
