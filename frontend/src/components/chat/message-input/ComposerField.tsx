import { useLayoutEffect, useRef, useState } from 'react';
import type { DragEvent, FormEvent, ReactNode, Ref } from 'react';
import clsx from 'clsx';
import { stateClasses } from '@/config/stateClasses';
import styles from './ComposerField.module.scss';

interface ComposerFieldProps {
  ref?: Ref<HTMLFormElement>;
  stacked?: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  message: string;
  // Longest first; the field shows the first one its text width fits
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
  stacked = false,
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
  const textRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const probeTextRef = useRef<HTMLSpanElement>(null);
  const probePlaceholdersRef = useRef<HTMLSpanElement>(null);
  const [multiline, setMultiline] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  // The layout decision is measured on the probe, which sits in the middle grid column: that
  // is the single-row text width in both layouts, so the decision never depends on the layout
  // it produces and cannot oscillate. The placeholder is measured on the text cell, which
  // spans the whole row once stacked; the layout never depends on it.
  useLayoutEffect(() => {
    const text = textRef.current;
    const probe = probeRef.current;
    const probeText = probeTextRef.current;
    const probePlaceholders = probePlaceholdersRef.current;
    if (!text || !probe || !probeText || !probePlaceholders) return;
    const measure = () => {
      const room = Math.floor(probe.getBoundingClientRect().width);
      const { paddingLeft, paddingRight } = getComputedStyle(text);
      const textRoom = Math.floor(
        text.getBoundingClientRect().width - parseFloat(paddingLeft) - parseFloat(paddingRight),
      );
      const width = (el: Element) => Math.ceil(el.getBoundingClientRect().width);
      const candidates = [...probePlaceholders.children];
      const fitsRow = candidates.some((el) => width(el) <= room);
      const index = candidates.findIndex((el) => width(el) <= textRoom);
      setMultiline(message.includes('\n') || width(probeText) > room || !fitsRow);
      setPlaceholderIndex(index === -1 ? candidates.length - 1 : index);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(probe);
    observer.observe(text);
    return () => observer.disconnect();
  }, [message, placeholders]);

  return (
    <form ref={ref} onSubmit={onSubmit} className={styles.composer}>
      <div {...dragHandlers} className={clsx(styles.field, isDragging && stateClasses.DRAGGING)}>
        {attachments}
        <div className={clsx(styles.row, (stacked || multiline) && styles['row--multiline'])}>
          <div className={styles.leading}>{leading}</div>
          <div ref={textRef} className={styles.text}>
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
