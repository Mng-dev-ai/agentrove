import { useState, useMemo, useRef, memo, type CSSProperties } from 'react';
import clsx from 'clsx';
import { ChevronRight, Brain } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FIND_REVEAL_EVENT } from '@/components/chat/chat-window/FindInChat';
import { useMountEffect } from '@/hooks/useMountEffect';
import styles from './ThinkingBlock.module.scss';

const DELAY_0: CSSProperties = { animationDelay: '0ms' };
const DELAY_150: CSSProperties = { animationDelay: '150ms' };
const DELAY_300: CSSProperties = { animationDelay: '300ms' };

interface ThinkingBlockProps {
  content: string;
  isActiveThinking: boolean;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  content,
  isActiveThinking,
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useMountEffect(() => {
    // Find-in-chat jumps to a match inside the collapsed body dispatch a reveal
    // event that bubbles up here — expand so the match is visible when it scrolls
    const node = rootRef.current;
    if (!node) return;
    const expand = () => setIsExpanded(true);
    node.addEventListener(FIND_REVEAL_EVENT, expand);
    return () => node.removeEventListener(FIND_REVEAL_EVENT, expand);
  });

  const previewText = useMemo(() => {
    if (!content) return '';
    const lines = content.split('\n');
    const firstLine = lines[0];
    if (firstLine.length > 60) {
      return firstLine.substring(0, 60) + '\u2026';
    }
    if (lines.length > 1) {
      return firstLine + '\u2026';
    }
    return firstLine;
  }, [content]);

  return (
    <div ref={rootRef}>
      <Button
        type="button"
        variant="unstyled"
        onClick={() => setIsExpanded((prev) => !prev)}
        className={styles['thinking-toggle']}
      >
        <Brain className={styles['thinking-icon']} />
        <span className={styles['thinking-label']}>
          {isActiveThinking ? 'Thinking' : 'Thought process'}
        </span>
        {isActiveThinking && (
          <div className={styles['thinking-dots']}>
            <div className={styles['thinking-dot']} style={DELAY_0} />
            <div className={styles['thinking-dot']} style={DELAY_150} />
            <div className={styles['thinking-dot']} style={DELAY_300} />
          </div>
        )}
        {!isExpanded && content && (
          // data-find-exclude: duplicates the body's first line and unmounts on
          // expand — matching it would leave dead find-in-chat ranges
          <span data-find-exclude className={styles['thinking-preview']}>
            {previewText}
          </span>
        )}
        <ChevronRight
          className={clsx(
            styles['thinking-chevron'],
            isExpanded && styles['thinking-chevron--expanded'],
          )}
        />
      </Button>

      <div
        className={clsx(
          styles['thinking-body'],
          isExpanded ? styles['thinking-body--expanded'] : styles['thinking-body--collapsed'],
        )}
      >
        {content && (
          <div className={styles['thinking-content']}>
            <div className={styles['thinking-text']}>{content}</div>
          </div>
        )}
      </div>
    </div>
  );
});
