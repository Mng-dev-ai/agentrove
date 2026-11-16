import { useLayoutEffect, useRef, useState } from 'react';
import type { DragEvent, FormEvent, ReactNode, Ref } from 'react';
import clsx from 'clsx';
import { stateClasses } from '@/config/stateClasses';
import styles from './ComposerField.module.scss';

interface ComposerFieldProps {
  ref?: Ref<HTMLFormElement>;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  message: string;
  // Longest first; the field shows the first one its single-row width fits
  placeholders: readonly string[];
  leading: ReactNode;
  textarea: (placeholder: string) => ReactNode;
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
  placeholders,
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
  const probePlaceholdersRef = useRef<HTMLSpanElement>(null);
  const [multiline, setMultiline] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  // The probe sits in the middle grid column, which is the single-row text width in both
  // layouts, so the decision never depends on the layout it produces and cannot oscillate.
  useLayoutEffect(() => {
    const probe = probeRef.current;
    const probeText = probeTextRef.current;
    const probePlaceholders = probePlaceholdersRef.current;
    if (!probe || !probeText || !probePlaceholders) return;
    const measure = () => {
      const room = Math.floor(probe.getBoundingClientRect().width);
      const fits = (el: Element) => Math.ceil(el.getBoundingClientRect().width) <= room;
      const candidates = [...probePlaceholders.children];
      const index = candidates.findIndex(fits);
      setMultiline(message.includes('\n') || !fits(probeText) || index === -1);
      setPlaceholderIndex(index === -1 ? candidates.length - 1 : index);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(probe);
    return () => observer.disconnect();
  }, [message, placeholders]);

  return (
    <form ref={ref} onSubmit={onSubmit} className={styles.composer}>
      <div {...dragHandlers} className={clsx(styles.field, isDragging && stateClasses.DRAGGING)}>
        {attachments}
        <div className={clsx(styles.row, multiline && styles['row--multiline'])}>
          <div className={styles.leading}>{leading}</div>
          <div className={styles.text}>
            {textarea(placeholders[Math.min(placeholderIndex, placeholders.length - 1)])}
          </div>
          <div className={styles.trailing}>{trailing}</div>
          <div ref={probeRef} aria-hidden className={styles.probe}>
            <span ref={probeTextRef}>{message}</span>
            <span ref={probePlaceholdersRef}>
              {placeholders.map((placeholder) => (
                <span key={placeholder}>{placeholder}</span>
              ))}
            </span>
          </div>
        </div>
      </div>
      {children}
    </form>
  );
}
