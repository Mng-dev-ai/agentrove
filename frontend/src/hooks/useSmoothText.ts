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
const HIGH_SURROGATE_RE = /[\uD800-\uDBFF]/;

export function useSmoothText(text: string, animate: boolean): string {
  // Init to full length so reconnect/nav mounts show buffered content immediately;
  // only post-mount appends animate.
  const [visibleCount, setVisibleCount] = useState(text.length);
  const visibleCountRef = useRef(visibleCount);
  const textRef = useRef(text);
  textRef.current = text;

  if (!animate && visibleCountRef.current !== text.length) {
    visibleCountRef.current = text.length;
    setVisibleCount(text.length);
  }

  useEffect(() => {
    if (!animate) return;

    let rafId = 0;
    let lastTick = performance.now();

    const tick = (now: number) => {
      const target = textRef.current.length;
      const visible = visibleCountRef.current;
      if (visible >= target) {
        lastTick = now;
      } else if (now - lastTick >= MIN_TICK_MS) {
        const delta = Math.min(now - lastTick, MAX_TICK_DELTA_MS);
        lastTick = now;
        const backlog = target - visible;
        const step = Math.max(1, Math.round((backlog * delta) / CATCH_UP_MS));
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
  }, [animate]);

  return animate ? text.slice(0, visibleCount) : text;
}
