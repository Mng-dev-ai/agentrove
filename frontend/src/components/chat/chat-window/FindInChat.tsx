import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useUIStore } from '@/store/uiStore';
import type { Message } from '@/types/chat.types';
import styles from './FindInChat.module.scss';

// Registry names referenced by the ::highlight() rules in FindInChat.module.scss
const HIGHLIGHT_ALL = 'find-in-chat';
const HIGHLIGHT_CURRENT = 'find-in-chat-current';

// Bubbling event dispatched from a match before jumping to it — collapsible blocks
// (ThinkingBlock) listen on their root and expand so the match is actually visible
export const FIND_REVEAL_EVENT = 'find-in-chat:reveal';

function isEmbeddedEditor(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // [data-terminal-search] is the terminal's own find bar — a ⌘F retype there
  // must re-select that bar's input, not open this one
  return !!target.closest('.monaco-editor, .xterm, [data-terminal-search]');
}

interface FindInChatProps {
  messages: Message[];
  scrollerRef: RefObject<HTMLDivElement | null>;
}

// ⌘F over rendered messages via CSS Custom Highlight (avoids <mark> in React-owned DOM).
export const FindInChat = memo(function FindInChat({ messages, scrollerRef }: FindInChatProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rangesRef = useRef<Range[]>([]);
  const activeIndexRef = useRef(0);
  const prevQueryRef = useRef('');
  // Debounced so the TreeWalker pass doesn't run on every keystroke
  const debouncedQuery = useDebouncedValue(query, 150);

  const setActiveMatch = useCallback(
    (index: number, scroll: boolean) => {
      activeIndexRef.current = index;
      setActiveIndex(index);
      CSS.highlights.delete(HIGHLIGHT_CURRENT);
      const range = rangesRef.current[index];
      if (!range) return;
      const current = new Highlight(range);
      // Wins over the all-matches highlight covering the same range
      current.priority = 1;
      CSS.highlights.set(HIGHLIGHT_CURRENT, current);
      if (!scroll) return;
      range.startContainer.parentElement?.dispatchEvent(
        new CustomEvent(FIND_REVEAL_EVENT, { bubbles: true }),
      );
      // Scroll a frame later so a reveal-triggered expansion has committed to the DOM
      requestAnimationFrame(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        // Nested scrollables (thinking traces cap their height and scroll internally)
        // must be scrolled first so the range's rect is valid in the outer scroller
        let ancestor = range.startContainer.parentElement;
        while (ancestor && ancestor !== scroller) {
          // overflow-y check, not scrollHeight: overflow-hidden clip containers
          // (e.g. a thinking body mid-expand-transition) must not be scrolled
          if (ancestor.scrollHeight > ancestor.clientHeight) {
            const overflowY = getComputedStyle(ancestor).overflowY;
            if (overflowY === 'auto' || overflowY === 'scroll') {
              const rect = range.getBoundingClientRect();
              const ancestorRect = ancestor.getBoundingClientRect();
              ancestor.scrollTop += rect.top - ancestorRect.top - ancestor.clientHeight / 2;
            }
          }
          ancestor = ancestor.parentElement;
        }
        const rect = range.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        // Already fully visible — jumping would re-center needlessly while typing
        if (rect.top >= scrollerRect.top && rect.bottom <= scrollerRect.bottom) return;
        const top = rect.top - scrollerRect.top + scroller.scrollTop - scroller.clientHeight / 2;
        scroller.scrollTo({ top, behavior: 'smooth' });
      });
    },
    [scrollerRef],
  );

  useMountEffect(() => {
    // Plain ⌘F only — shifted chords stay free for global shortcuts; Monaco/xterm keep their own find
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.code !== 'KeyF') return;
      if (isEmbeddedEditor(e.target)) return;
      if (useUIStore.getState().commandMenuOpen) return;
      e.preventDefault();
      setOpen(true);
      // Already open: re-select the query for immediate retyping
      inputRef.current?.select();
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  });

  useEffect(() => {
    // Focus after the open commit — the input isn't in the DOM before it
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  useEffect(() => {
    // messages.length gate doubles as the dep read: rescanning on every messages
    // change keeps matches fresh while streaming or paginating older pages in
    const scroller = scrollerRef.current;
    rangesRef.current = [];
    const needle = debouncedQuery.toLowerCase();
    if (open && needle && scroller && messages.length > 0) {
      const ranges: Range[] = [];
      for (const el of scroller.querySelectorAll('[data-message-id]')) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const lower = node.textContent?.toLowerCase();
          if (!lower) continue;
          // Preview snippets duplicate content matched elsewhere and unmount on
          // expand, which would leave dead ranges behind
          if (node.parentElement?.closest('[data-find-exclude]')) continue;
          let idx = lower.indexOf(needle);
          while (idx !== -1) {
            const range = new Range();
            range.setStart(node, idx);
            range.setEnd(node, idx + needle.length);
            // display:none content has no boxes and can't be revealed by a jump — skip
            // it; CSS-clipped collapsibles keep boxes and expand via FIND_REVEAL_EVENT
            if (range.getClientRects().length > 0) ranges.push(range);
            idx = lower.indexOf(needle, idx + needle.length);
          }
        }
      }
      rangesRef.current = ranges;
    }
    const ranges = rangesRef.current;
    setMatchCount(ranges.length);
    if (ranges.length > 0) {
      CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...ranges));
    } else {
      CSS.highlights.delete(HIGHLIGHT_ALL);
    }
    // Jump to the first match on a new query; hold position on streaming rescans
    const queryChanged = prevQueryRef.current !== debouncedQuery;
    prevQueryRef.current = debouncedQuery;
    const index = queryChanged
      ? 0
      : Math.min(activeIndexRef.current, Math.max(0, ranges.length - 1));
    setActiveMatch(index, queryChanged);
    return () => {
      CSS.highlights.delete(HIGHLIGHT_ALL);
      CSS.highlights.delete(HIGHLIGHT_CURRENT);
    };
  }, [open, debouncedQuery, messages, scrollerRef, setActiveMatch]);

  const goToNext = useCallback(() => {
    const count = rangesRef.current.length;
    if (count > 0) setActiveMatch((activeIndexRef.current + 1) % count, true);
  }, [setActiveMatch]);

  const goToPrev = useCallback(() => {
    const count = rangesRef.current.length;
    if (count > 0) setActiveMatch((activeIndexRef.current - 1 + count) % count, true);
  }, [setActiveMatch]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          goToPrev();
        } else {
          goToNext();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    },
    [goToNext, goToPrev],
  );

  if (!open) return null;

  return (
    <div role="search" className={styles['find-in-chat']}>
      <Search className={styles['search-icon']} />
      <Input
        ref={inputRef}
        variant="unstyled"
        type="text"
        role="searchbox"
        aria-label="Find in chat"
        placeholder="Find in chat"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleInputKeyDown}
        className={styles['find-input']}
      />
      {debouncedQuery && (
        <span aria-live="polite" className={styles.count}>
          {matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : '0/0'}
        </span>
      )}
      <Button
        variant="unstyled"
        onClick={goToPrev}
        disabled={matchCount === 0}
        aria-label="Previous match"
        className={styles['nav-button']}
      >
        <ChevronUp className={styles['nav-icon']} />
      </Button>
      <Button
        variant="unstyled"
        onClick={goToNext}
        disabled={matchCount === 0}
        aria-label="Next match"
        className={styles['nav-button']}
      >
        <ChevronDown className={styles['nav-icon']} />
      </Button>
      <Button
        variant="unstyled"
        onClick={() => setOpen(false)}
        aria-label="Close find"
        className={styles['nav-button']}
      >
        <X className={styles['nav-icon']} />
      </Button>
    </div>
  );
});
