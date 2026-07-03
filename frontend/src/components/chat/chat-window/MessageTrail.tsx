import { memo, useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/primitives/Button';
import type { Message } from '@/types/chat.types';

// Cap preview text so a huge message doesn't dump megabytes into the DOM
const PREVIEW_MAX_CHARS = 200;
const TICK_SPACING_PX = 12;
// Width of the centered message column (lg:max-w-4xl = 56rem)
const MESSAGE_COLUMN_MAX_PX = 896;
const MIN_GUTTER_PX = 40;
const ACTIVE_VIEWPORT_FRACTION = 0.4;

interface TrailTurn {
  id: string;
  userText: string;
  assistantText: string;
}

interface MessageTrailProps {
  messages: Message[];
  scrollerRef: RefObject<HTMLDivElement | null>;
}

export const MessageTrail = memo(function MessageTrail({
  messages,
  scrollerRef,
}: MessageTrailProps) {
  const turns = useMemo(() => {
    const result: TrailTurn[] = [];
    for (const msg of messages) {
      const isBotMessage = msg.is_bot ?? msg.role === 'assistant';
      if (!isBotMessage) {
        result.push({
          id: msg.id,
          userText: msg.content_text.slice(0, PREVIEW_MAX_CHARS),
          assistantText: '',
        });
      } else {
        // Preview only the first assistant reply of the turn; a leading assistant
        // message with no preceding user turn (mid-turn pagination page) has no tick.
        const turn = result[result.length - 1];
        if (turn && !turn.assistantText) {
          turn.assistantText = msg.content_text.slice(0, PREVIEW_MAX_CHARS);
        }
      }
    }
    return result;
  }, [messages]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || turns.length === 0) return;

    // Compact by the pane's actual left gutter, not a viewport breakpoint — open
    // sidebars narrow the pane until the message column reaches the edge; the
    // slimmer rail fits within the column's edge padding without covering text.
    const resizeObserver = new ResizeObserver(() => {
      setIsCompact((scroller.clientWidth - MESSAGE_COLUMN_MAX_PX) / 2 < MIN_GUTTER_PX);
    });
    resizeObserver.observe(scroller);

    const updateActive = () => {
      // Active turn = last user message whose top has crossed the upper part of
      // the viewport, so the tick tracks what the user is currently reading.
      const scrollerTop = scroller.getBoundingClientRect().top;
      const threshold = scroller.clientHeight * ACTIVE_VIEWPORT_FRACTION;
      let current = turns[0].id;
      for (const turn of turns) {
        const el = scroller.querySelector(`[data-message-id="${CSS.escape(turn.id)}"]`);
        if (el && el.getBoundingClientRect().top - scrollerTop <= threshold) {
          current = turn.id;
        }
      }
      setActiveId(current);
    };

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateActive();
      });
    };

    updateActive();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollerRef, turns]);

  const scrollToTurn = useCallback(
    (id: string) => {
      const scroller = scrollerRef.current;
      const el = scroller?.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
      if (!scroller || !el) return;
      const top =
        el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      scroller.scrollTo({ top: top - 12, behavior: 'smooth' });
    },
    [scrollerRef],
  );

  if (turns.length < 2) return null;

  return (
    <div className="pointer-events-none absolute inset-y-6 left-0 z-10 hidden flex-col justify-center lg:flex">
      {/* Rail height caps at preferred spacing so short chats stay a compact cluster,
          while long chats distribute ticks proportionally without clipping */}
      <div
        className="relative"
        style={{ height: `min(100%, ${turns.length * TICK_SPACING_PX}px)` }}
      >
        {turns.map((turn, index) => (
          <div
            key={turn.id}
            style={{ top: `${(index / (turns.length - 1)) * 100}%` }}
            className="group pointer-events-auto absolute left-0 flex -translate-y-1/2 items-center"
          >
            <Button
              variant="unstyled"
              onClick={() => scrollToTurn(turn.id)}
              aria-label={`Jump to message: ${turn.userText.slice(0, 60)}`}
              className={cn('flex h-2.5 items-center', isCompact ? 'px-1' : 'px-2')}
            >
              <span
                className={cn(
                  'h-0.5 rounded-full transition-all duration-200',
                  turn.id === activeId
                    ? cn('bg-text-primary dark:bg-text-dark-primary', isCompact ? 'w-2.5' : 'w-4')
                    : cn(
                        'bg-text-quaternary/50 group-hover:bg-text-tertiary dark:bg-text-dark-quaternary/50 dark:group-hover:bg-text-dark-tertiary',
                        isCompact ? 'w-1.5 group-hover:w-2' : 'w-2.5 group-hover:w-3.5',
                      ),
                )}
              />
            </Button>
            <div className="pointer-events-none invisible absolute left-full top-1/2 z-20 w-72 -translate-y-1/2 rounded-xl border border-border/50 bg-surface/95 px-3 py-2 opacity-0 shadow-medium backdrop-blur-xl transition-opacity duration-200 group-hover:visible group-hover:opacity-100 dark:border-border-dark/50 dark:bg-surface-dark/95">
              <p className="line-clamp-1 text-xs font-medium text-text-primary dark:text-text-dark-primary">
                {turn.userText}
              </p>
              {turn.assistantText && (
                <p className="mt-1 line-clamp-3 text-xs text-text-secondary dark:text-text-dark-secondary">
                  {turn.assistantText}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
