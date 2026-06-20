import { memo, useState, useRef } from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';

interface ThinkingIndicatorProps {
  streamStartTime?: number;
}

export const ThinkingIndicator = memo(function ThinkingIndicator({
  streamStartTime,
}: ThinkingIndicatorProps) {
  const [elapsed, setElapsed] = useState(0);
  // Seed from the active stream's start so the timer survives chat switches —
  // the indicator sits inside the chat-keyed scroller and remounts on switch.
  // Fall back to mount time when loading begins before the stream exists yet.
  const startTime = useRef(streamStartTime ?? Date.now());

  useMountEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  });

  return (
    <div className="animate-fade-in px-4 pb-1.5 sm:px-6 sm:pb-2">
      <div className="flex items-center gap-2">
        <div className="flex h-3 w-3 flex-wrap items-center justify-center gap-[2px]">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[3px] w-[3px] animate-dot-pulse rounded-full bg-text-quaternary dark:bg-text-dark-quaternary"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>

        <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">Thinking…</span>

        {elapsed > 0 && (
          <span className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
            · {elapsed}s
          </span>
        )}
      </div>
    </div>
  );
});
