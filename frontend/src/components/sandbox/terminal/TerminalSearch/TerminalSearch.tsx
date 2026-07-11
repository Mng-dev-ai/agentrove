import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { ISearchResultChangeEvent, SearchAddon } from '@xterm/addon-search';

import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import { IS_MAC_PLATFORM } from '@/utils/platform';
import { buildSearchDecorations } from '@/utils/terminal';
import type { Palette } from '@/types/ui.types';
import styles from './TerminalSearch.module.scss';

interface TerminalSearchProps {
  isReady: boolean;
  palette: Palette;
  searchAddonRef: MutableRefObject<SearchAddon | null>;
  terminalRef: MutableRefObject<XTerm | null>;
}

// Terminal find bar driving @xterm/addon-search: the addon selects the active
// match, decorates the rest, and reports index/count via onDidChangeResults.
export function TerminalSearch({
  isReady,
  palette,
  searchAddonRef,
  terminalRef,
}: TerminalSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ISearchResultChangeEvent | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const decorations = useMemo(() => buildSearchDecorations(palette), [palette]);

  useEffect(() => {
    // ⌘F on mac, Ctrl+F elsewhere — plain Ctrl+F must keep reaching the shell
    // on mac (readline forward-char). Returning false stops xterm from writing
    // the chord to the PTY; preventDefault suppresses the browser's find.
    if (!isReady) {
      return;
    }
    terminalRef.current?.attachCustomKeyEventHandler((event) => {
      const modifier = IS_MAC_PLATFORM ? event.metaKey : event.ctrlKey;
      if (
        event.type === 'keydown' &&
        modifier &&
        !event.shiftKey &&
        !event.altKey &&
        event.code === 'KeyF'
      ) {
        event.preventDefault();
        setOpen(true);
        return false;
      }
      return true;
    });
    // No detach API — the handler is disposed with the terminal itself.
  }, [isReady, terminalRef]);

  useEffect(() => {
    if (!isReady) {
      return undefined;
    }
    const addon = searchAddonRef.current;
    if (!addon) {
      return undefined;
    }
    const disposable = addon.onDidChangeResults((event) => setResult(event));
    return () => disposable.dispose();
  }, [isReady, searchAddonRef]);

  useEffect(() => {
    if (!open || !isReady) {
      return;
    }
    const addon = searchAddonRef.current;
    if (!addon) {
      return;
    }
    if (!query) {
      // clearDecorations fires no results event — reset the count manually.
      addon.clearDecorations();
      setResult(null);
      return;
    }
    // Incremental: while typing, the current match stays selected if it still
    // matches the extended term instead of jumping to the next occurrence.
    addon.findNext(query, { incremental: true, decorations });
  }, [open, isReady, query, decorations, searchAddonRef]);

  useEffect(() => {
    // Focus after the open commit — the input isn't in the DOM before it
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setResult(null);
    searchAddonRef.current?.clearDecorations();
    terminalRef.current?.focus();
  }, [searchAddonRef, terminalRef]);

  const goToNext = useCallback(() => {
    if (query) {
      searchAddonRef.current?.findNext(query, { decorations });
    }
  }, [query, decorations, searchAddonRef]);

  const goToPrev = useCallback(() => {
    if (query) {
      searchAddonRef.current?.findPrevious(query, { decorations });
    }
  }, [query, decorations, searchAddonRef]);

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
        close();
      } else if (
        (IS_MAC_PLATFORM ? e.metaKey : e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.code === 'KeyF'
      ) {
        // Re-pressed while the bar is focused: re-select for immediate retyping
        e.preventDefault();
        inputRef.current?.select();
      }
    },
    [goToNext, goToPrev, close],
  );

  if (!open) return null;

  const hasMatches = !!result && result.resultCount > 0;

  return (
    // data-terminal-search lets FindInChat's global ⌘F handler yield to this bar
    <div role="search" data-terminal-search className={styles['terminal-search']}>
      <Search className={styles['search-icon']} />
      <Input
        ref={inputRef}
        variant="unstyled"
        type="text"
        role="searchbox"
        aria-label="Find in terminal"
        placeholder="Find in terminal"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleInputKeyDown}
        className={styles['find-input']}
      />
      {query && result && (
        <span aria-live="polite" className={styles.count}>
          {/* resultIndex is -1 past the addon's highlight limit — count only */}
          {result.resultIndex >= 0
            ? `${result.resultIndex + 1}/${result.resultCount}`
            : hasMatches
              ? `${result.resultCount}+`
              : '0/0'}
        </span>
      )}
      <Button
        variant="unstyled"
        onClick={goToPrev}
        disabled={!hasMatches}
        aria-label="Previous match"
        className={styles['nav-button']}
      >
        <ChevronUp className={styles['nav-icon']} />
      </Button>
      <Button
        variant="unstyled"
        onClick={goToNext}
        disabled={!hasMatches}
        aria-label="Next match"
        className={styles['nav-button']}
      >
        <ChevronDown className={styles['nav-icon']} />
      </Button>
      <Button
        variant="unstyled"
        onClick={close}
        aria-label="Close find"
        className={styles['nav-button']}
      >
        <X className={styles['nav-icon']} />
      </Button>
    </div>
  );
}
