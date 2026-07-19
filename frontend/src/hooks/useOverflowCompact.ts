import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

// A wrapping flex row has pushed a child below the first one. Children sharing
// a line can still have different offsetTops (align-items: center with
// different heights), so "below" means the last child's midpoint sits past the
// first child's bottom — true on a wrapped line, never within one.
function isWrapped(row: HTMLElement): boolean {
  const first = row.firstElementChild as HTMLElement | null;
  const last = row.lastElementChild as HTMLElement | null;
  if (!first || !last || first === last) return false;
  return last.offsetTop + last.offsetHeight / 2 > first.offsetTop + first.offsetHeight;
}

// Overflow-driven compacting for the composer footer: true once the fully
// labeled row wraps, so labels can collapse to icons — the same collapse the
// sm breakpoint gives phones, but keyed to the row's real width (sidebar open,
// split view, long model/branch names) instead of the viewport.
export function useOverflowCompact(rowRef: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  // Row width at which labels last overflowed. Labels are only retried once
  // the row grows past it, so a constant-width row can't flip-flop; if the
  // retry wraps again, the wrap re-triggers a measure and we re-compact.
  const overflowWidthRef = useRef(0);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      if (isWrapped(row)) {
        overflowWidthRef.current = Math.max(overflowWidthRef.current, row.clientWidth);
        setCompact(true);
      } else if (row.clientWidth > overflowWidthRef.current) {
        setCompact(false);
      }
    };
    measure();
    // Fires on width changes and on the height change a wrap causes.
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    // A wrap measured with fallback-font metrics could latch compact for a row
    // that fits once the real fonts load — retry labels from scratch then.
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      overflowWidthRef.current = 0;
      setCompact(false);
    });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [rowRef]);

  return compact;
}
