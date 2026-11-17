import { useEffect, useRef, useState } from 'react';

// Reveal pending text over ~350ms so the display tracks the network position
// closely while still reading as a steady stream instead of bursts.
const CATCH_UP_MS = 350;
// Minimum interval between reveal steps — caps markdown re-parses of the
// growing tail block at ~30 updates/sec.
const MIN_TICK_MS = 33;
// Cap the per-step time delta so a pause (hidden tab, slow token gaps) doesn't
// dump the whole backlog in one frame when ticks resume.
const MAX_TICK_DELTA_MS = 100;
// Once the stream stops feeding the text, the rest is revealed at least this fast, so
// whatever waits on the reveal (a reply's action row) is not held by a slow last few words.
const FINISH_MS = 400;
const HIGH_SURROGATE_RE = /[\uD800-\uDBFF]/;

function sharedPrefixLength(a: string, b: string) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export function useSmoothText(
  text: string,
  animate: boolean,
  finishReveal = false,
): [string, boolean] {
  // Init to full length so reconnect/nav mounts show buffered content immediately;
  // only post-mount appends animate.
  const [visibleCount, setVisibleCount] = useState(text.length);
  const visibleCountRef = useRef(visibleCount);
  const textRef = useRef(text);
  const animateRef = useRef(animate);
  animateRef.current = animate;

  // Replaced text reveals from where it stops matching what is on screen: from the start
  // for a new segment, not at all when only trailing whitespace was trimmed.
  const shown = textRef.current.slice(0, visibleCountRef.current);
  if (finishReveal && !text.startsWith(shown)) {
    const kept = sharedPrefixLength(shown, text);
    visibleCountRef.current = kept;
    setVisibleCount(kept);
  }
  textRef.current = text;
  const revealing = animate || (finishReveal && visibleCountRef.current < text.length);

  if (!revealing && visibleCountRef.current !== text.length) {
    visibleCountRef.current = text.length;
    setVisibleCount(text.length);
  }

  useEffect(() => {
    if (!revealing) return;

    let rafId = 0;
    let lastTick = performance.now();
    let finishRate = 0;

    const tick = (now: number) => {
      const target = textRef.current.length;
      const visible = visibleCountRef.current;
      if (visible >= target) {
        lastTick = now;
      } else if (now - lastTick >= MIN_TICK_MS) {
        const delta = Math.min(now - lastTick, MAX_TICK_DELTA_MS);
        lastTick = now;
        const backlog = target - visible;
        if (animateRef.current) finishRate = 0;
        else if (!finishRate) finishRate = backlog / FINISH_MS;
        const step = Math.max(
          1,
          Math.round((backlog * delta) / CATCH_UP_MS),
          Math.ceil(finishRate * delta),
        );
        let next = Math.min(target, visible + step);
        // Don't split a surrogate pair — slicing mid-emoji flashes a replacement char
        if (next < target && HIGH_SURROGATE_RE.test(textRef.current[next - 1])) next++;
        visibleCountRef.current = next;
        setVisibleCount(next);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [revealing]);

  return [revealing ? text.slice(0, visibleCount) : text, revealing];
}
