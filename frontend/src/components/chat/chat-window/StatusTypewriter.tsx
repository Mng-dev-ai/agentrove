import { memo, useEffect, useRef, useState } from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';
import { cn } from '@/utils/cn';

const VERBS = ['Pondering', 'Connecting dots', 'Drafting', 'Refining'];
const TYPE_MS = 55;
const DELETE_MS = 30;
const HOLD_MS = 1800;
const GAP_MS = 300;

// Count the in-progress second so the timer reads 1s the moment it appears, not 0s
const secondsSince = (start: number) => Math.max(1, Math.ceil((Date.now() - start) / 1000));

interface StatusTypewriterProps {
  streamStartTime?: number;
}

export const StatusTypewriter = memo(function StatusTypewriter({
  streamStartTime,
}: StatusTypewriterProps) {
  // Seed from the active stream's start so the timer survives chat switches —
  // the indicator sits inside the chat-keyed scroller and remounts on switch.
  // Fall back to mount time when loading begins before the stream exists yet.
  const startTime = useRef(streamStartTime ?? Date.now());
  const [elapsed, setElapsed] = useState(() => secondsSince(startTime.current));
  const [text, setText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [verbIndex, setVerbIndex] = useState(0);
  // Adopt the real stream start when it arrives after mount instead of remounting
  // via key — a remount would restart the typewriter and replay the fade-in.
  // A cleared prop means a new turn is loading (queued message, stop-then-resend) —
  // restart the clock instead of carrying the old stream's elapsed forward.
  const prevStreamStart = useRef(streamStartTime);
  if (prevStreamStart.current !== streamStartTime) {
    prevStreamStart.current = streamStartTime;
    startTime.current = streamStartTime ?? Date.now();
    setElapsed(secondsSince(startTime.current));
  }

  useMountEffect(() => {
    const interval = setInterval(() => {
      setElapsed(secondsSince(startTime.current));
    }, 1000);

    return () => clearInterval(interval);
  });

  const verb = VERBS[verbIndex];
  // Caret blinks only while a full verb is held — stays solid mid-keystroke like a live cursor
  const holding = !deleting && text === verb;

  useEffect(() => {
    // Single re-armed timeout instead of an interval so each phase (type/hold/delete/gap)
    // picks its own cadence and unmount cancels the pending step cleanly.
    let delay: number;
    let tick: () => void;
    if (deleting) {
      if (text.length > 0) {
        delay = DELETE_MS;
        tick = () => setText(text.slice(0, -1));
      } else {
        delay = GAP_MS;
        tick = () => {
          setVerbIndex((i) => (i + 1) % VERBS.length);
          setDeleting(false);
        };
      }
    } else if (text.length < verb.length) {
      delay = TYPE_MS;
      tick = () => setText(verb.slice(0, text.length + 1));
    } else {
      delay = HOLD_MS;
      tick = () => setDeleting(true);
    }
    const timeout = setTimeout(tick, delay);

    return () => clearTimeout(timeout);
  }, [text, deleting, verb]);

  return (
    // Padding mirrors the assistant message row (Message.tsx) so the swap from
    // indicator to content doesn't shift the text down.
    <div className="animate-fade-in px-4 py-1.5 sm:px-6 sm:py-2">
      <div className="flex items-center gap-2">
        <span className="flex items-center text-xs text-text-tertiary dark:text-text-dark-tertiary">
          {text}
          <span
            className={cn(
              'ml-px inline-block h-3 w-px bg-text-tertiary dark:bg-text-dark-tertiary',
              holding && 'animate-caret-blink',
            )}
          />
        </span>

        <span className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
          · {elapsed}s
        </span>
      </div>
    </div>
  );
});
