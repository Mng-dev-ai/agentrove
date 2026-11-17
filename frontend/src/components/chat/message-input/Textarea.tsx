import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useCallback,
  type CSSProperties,
  type Ref,
} from 'react';
import clsx from 'clsx';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getHighlightTokenRanges } from '@/utils/mentionParser';
import { HighlightedText } from '@/components/ui/shared/HighlightedText/HighlightedText';
import { Textarea as PrimitiveTextarea } from '@/components/ui/primitives/Textarea/Textarea';
import styles from './Textarea.module.scss';

const THIN_SCROLLBAR_STYLE: CSSProperties = { scrollbarWidth: 'thin' };

const BACKDROP_TOKEN_CLASSNAME = styles['backdrop-token'];

// Invisible scrollbar that still reserves the same thin gutter as the textarea's,
// so both layers wrap long lines at the same width when content overflows.
const BACKDROP_SCROLLBAR_STYLE: CSSProperties = {
  scrollbarWidth: 'thin',
  scrollbarColor: 'transparent transparent',
};

export interface TextareaProps {
  ref?: Ref<HTMLTextAreaElement>;
  message: string;
  setMessage: (value: string) => void;
  placeholder: string;
  isLoading: boolean;
  disabled?: boolean;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onCursorPositionChange?: (position: number) => void;
}

const CURSOR_DEBOUNCE_MS = 150;

export function Textarea({
  ref,
  message,
  setMessage,
  placeholder,
  isLoading,
  disabled = false,
  onKeyDown,
  onPaste,
  onCursorPositionChange,
}: TextareaProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = (ref as React.RefObject<HTMLTextAreaElement>) || internalRef;
  const backdropRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCursorPositionRef = useRef<number>(-1);
  const isMobile = useIsMobile();

  const hasTokens = useMemo(() => getHighlightTokenRanges(message).length > 0, [message]);

  const syncBackdropScroll = useCallback(() => {
    if (backdropRef.current && textareaRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, [textareaRef]);

  const fitHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
    // Content changes can shift the textarea's scroll position without a scroll event
    syncBackdropScroll();
  }, [textareaRef, syncBackdropScroll]);

  useLayoutEffect(() => {
    fitHeight();
  }, [message, fitHeight]);

  const widthRef = useRef(0);
  const fitToWidth = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.clientWidth === widthRef.current) return;
    widthRef.current = textarea.clientWidth;
    fitHeight();
  }, [textareaRef, fitHeight]);

  // The composer re-lays out after a message change (single row vs. own row) in a later
  // commit, which changes the wrap width without changing the message.
  useLayoutEffect(fitToWidth);

  // Window and panel resizes refit a frame later: resizing the composer inside the callback
  // would re-resize the chat scroller, which observers already handled in this frame.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitToWidth);
    });
    observer.observe(textarea);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [textareaRef, fitToWidth]);

  useEffect(() => {
    if (!isLoading && textareaRef.current && !isMobile) {
      textareaRef.current.focus();
    }
  }, [isLoading, isMobile, textareaRef]);

  useMountEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  });

  const debouncedCursorChange = useCallback(
    (position: number) => {
      if (!onCursorPositionChange) return;
      if (position === lastCursorPositionRef.current) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        lastCursorPositionRef.current = position;
        onCursorPositionChange(position);
      }, CURSOR_DEBOUNCE_MS);
    },
    [onCursorPositionChange],
  );

  const handleCursorChange = useCallback(() => {
    if (textareaRef.current) {
      debouncedCursorChange(textareaRef.current.selectionStart);
    }
  }, [debouncedCursorChange, textareaRef]);

  const scrollIntoViewOnMobile = useCallback(() => {
    if (isMobile && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 150);
    }
  }, [isMobile, textareaRef]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setMessage(e.target.value);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      const position = e.target.selectionStart;
      lastCursorPositionRef.current = position;
      onCursorPositionChange?.(position);
    },
    [setMessage, onCursorPositionChange],
  );

  return (
    <div className={styles.textarea}>
      {hasTokens && (
        // Mirrors the textarea so individual tokens can be colored without changing its value.
        <div
          ref={backdropRef}
          aria-hidden
          className={clsx(styles.backdrop, (isLoading || disabled) && styles['backdrop--dimmed'])}
          style={BACKDROP_SCROLLBAR_STYLE}
        >
          <HighlightedText text={message} tokenClassName={BACKDROP_TOKEN_CLASSNAME} />
          {/* Zero-width space so a trailing newline renders a line box — keeps this
              layer's scrollHeight equal to the textarea's for scroll sync */}
          {'\u200b'}
        </div>
      )}
      <PrimitiveTextarea
        ref={textareaRef}
        variant="unstyled"
        value={message}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onKeyUp={handleCursorChange}
        onClick={handleCursorChange}
        onSelect={handleCursorChange}
        onFocus={scrollIntoViewOnMobile}
        onScroll={syncBackdropScroll}
        placeholder={placeholder}
        disabled={isLoading || disabled}
        rows={1}
        className={clsx(
          styles['textarea-field'],
          hasTokens && styles['textarea-field--highlighted'],
        )}
        style={THIN_SCROLLBAR_STYLE}
        aria-label="Message input"
      />
    </div>
  );
}
