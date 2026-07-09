import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useCallback,
  type CSSProperties,
  type Ref,
} from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getHighlightTokenRanges } from '@/utils/mentionParser';
import { HighlightedText } from '@/components/ui/shared/HighlightedText';
import { Textarea as PrimitiveTextarea } from '@/components/ui/primitives/Textarea/Textarea';

const THIN_SCROLLBAR_STYLE: CSSProperties = { scrollbarWidth: 'thin' };

// Backdrop variant of the pill: no text colors (the textarea's own glyphs render
// on top) and negative margins so the painted background doesn't shift the flow.
const BACKDROP_TOKEN_CLASSNAME =
  '-mx-0.5 rounded box-decoration-clone bg-surface-active p-0.5 dark:bg-surface-dark-active';

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
  compact?: boolean;
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
  compact,
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

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
    // Content changes can shift the textarea's scroll position without a scroll event
    syncBackdropScroll();
  }, [message, textareaRef, syncBackdropScroll]);

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
    <div className="relative">
      {hasTokens && (
        // Paints pill backgrounds behind @mention and /command tokens; the textarea's own
        // glyphs render on top, so this layer's text is transparent and must mirror the
        // textarea's typography, padding, and wrapping exactly.
        <div
          ref={backdropRef}
          aria-hidden
          className={`pointer-events-none absolute inset-0 max-h-[180px] overflow-y-auto whitespace-pre-wrap break-words py-1.5 text-xs leading-normal text-transparent ${isLoading || disabled ? 'opacity-50' : ''}`}
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
        className={`relative max-h-[180px] w-full resize-none overflow-y-auto bg-transparent py-1.5 text-xs leading-normal text-text-primary outline-none transition-all duration-200 placeholder:text-text-quaternary focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary ${isMobile && compact ? 'min-h-[28px]' : 'min-h-[36px]'}`}
        style={THIN_SCROLLBAR_STYLE}
        aria-label="Message input"
      />
    </div>
  );
}
