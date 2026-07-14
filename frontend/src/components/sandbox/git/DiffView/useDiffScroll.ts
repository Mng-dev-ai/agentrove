import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { SCROLL_KEYS, findScroller } from './diffView.utils';

interface UseDiffScrollParams {
  // Scopes the jump-scroll query to this tile's DOM.
  rootRef: RefObject<HTMLDivElement | null>;
  // Diff pane wrapper — its top edge is the scrollspy's reference line.
  paneRef: RefObject<HTMLDivElement | null>;
  scopeKey: string;
  showFiles: boolean;
  setActiveFile: Dispatch<SetStateAction<string | null>>;
  setCollapsedFiles: Dispatch<SetStateAction<Set<string>>>;
  reviewCollapsedRef: RefObject<Set<string>>;
}

// Jump-to-file scrolling + scrollspy for the diff pane: a hand-rolled jump
// animation, the scrollspy that tracks the top-most file, and the gestures that
// cancel an in-flight jump.
export function useDiffScroll({
  rootRef,
  paneRef,
  scopeKey,
  showFiles,
  setActiveFile,
  setCollapsedFiles,
  reviewCollapsedRef,
}: UseDiffScrollParams) {
  // In-flight jump animation — a new click, scope change, or unmount cancels it.
  const jumpRafRef = useRef(0);
  const cancelJump = useCallback(() => {
    cancelAnimationFrame(jumpRafRef.current);
    jumpRafRef.current = 0;
  }, []);

  const jumpToFile = useCallback(
    (name: string) => {
      setActiveFile(name);
      // Expanding to show the file releases our review-collapse claim on it.
      reviewCollapsedRef.current.delete(name);
      setCollapsedFiles((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      cancelJump();
      // rAF: a just-expanded file needs a render before its body has height.
      jumpRafRef.current = requestAnimationFrame(() => {
        const el = rootRef.current?.querySelector<HTMLElement>(
          `[data-diff-file-path="${CSS.escape(name)}"]`,
        );
        if (!el) return;
        const scroller = findScroller(el, paneRef.current);
        if (!scroller) return;
        // Hand-rolled animation instead of smooth scrollIntoView: the Virtualizer
        // reconciles estimated heights as content renders in, shifting the target
        // mid-flight — scrollIntoView animates to the position measured at call
        // time and lands on a neighboring file. Re-measuring every frame converges
        // on the live position; instant teleports are equally off the table since
        // the Virtualizer only renders from scroll/intersection events.
        let frames = 0;
        const step = () => {
          const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          if (Math.abs(delta) < 1) {
            scroller.scrollTop += delta;
            return;
          }
          scroller.scrollTop +=
            Math.sign(delta) * Math.min(Math.abs(delta), Math.max(Math.abs(delta) * 0.3, 24));
          // Frame cap so a target that never settles can't animate forever.
          if ((frames += 1) < 180) jumpRafRef.current = requestAnimationFrame(step);
        };
        step();
      });
    },
    [cancelJump, paneRef, reviewCollapsedRef, rootRef, setActiveFile, setCollapsedFiles],
  );

  // Scope changes must cancel before a stale frame can run against the new diff.
  useLayoutEffect(() => cancelJump, [cancelJump, scopeKey]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !showFiles) return;
    const cancelKeyboardScroll = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) cancelJump();
    };
    // A user gesture means the click-initiated jump should yield immediately.
    root.addEventListener('pointerdown', cancelJump, { capture: true, passive: true });
    root.addEventListener('wheel', cancelJump, { capture: true, passive: true });
    root.addEventListener('keydown', cancelKeyboardScroll, { capture: true });
    return () => {
      root.removeEventListener('pointerdown', cancelJump, { capture: true });
      root.removeEventListener('wheel', cancelJump, { capture: true });
      root.removeEventListener('keydown', cancelKeyboardScroll, { capture: true });
    };
  }, [cancelJump, rootRef, showFiles]);

  // Scrollspy — capture-phase because scroll doesn't bubble and the Virtualizer
  // owns the scroll container. The last header within 32px of the pane top wins,
  // so the active file flips as each sticky header reaches its pinned position.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !showFiles) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const pane = paneRef.current;
        if (!pane) return;
        const paneTop = pane.getBoundingClientRect().top;
        let current: string | null = null;
        const wrappers = pane.querySelectorAll<HTMLElement>('[data-diff-file-path]');
        for (const wrapper of wrappers) {
          if (wrapper.getBoundingClientRect().top - paneTop > 32) break;
          current = wrapper.dataset.diffFilePath ?? null;
        }
        // Trailing files shorter than the pane never reach the top reference
        // line — at the scroll end, highlight the last file instead.
        const last = wrappers[wrappers.length - 1];
        const scroller = last && findScroller(last, pane);
        if (scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
          current = last.dataset.diffFilePath ?? current;
        }
        if (current) setActiveFile(current);
      });
    };
    root.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll, { capture: true });
      if (raf) cancelAnimationFrame(raf);
    };
  }, [paneRef, rootRef, setActiveFile, showFiles]);

  return { jumpToFile };
}
