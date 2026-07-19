import { memo, useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { isAssistantMessage } from '@/utils/message';
import type { Message } from '@/types/chat.types';
import styles from './MessageTrail.module.scss';

// Cap preview text so a huge message doesn't dump megabytes into the DOM
const PREVIEW_MAX_CHARS = 200;
const TICK_SPACING_PX = 12;
// Width of the centered message column (Chat.module.scss .column max-width: 67.2rem)
const MESSAGE_COLUMN_MAX_PX = 67.2 * 16;
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
      if (!isAssistantMessage(msg)) {
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
    <div className={styles.trail}>
      {/* Rail height caps at preferred spacing so short chats stay a compact cluster,
          while long chats distribute ticks proportionally without clipping */}
      <div
        className={styles['trail-rail']}
        style={{ height: `min(100%, ${turns.length * TICK_SPACING_PX}px)` }}
      >
        {turns.map((turn, index) => {
          const isActive = turn.id === activeId;
          const tickModifier = isActive
            ? isCompact
              ? 'tick--active-compact'
              : 'tick--active'
            : isCompact
              ? 'tick--inactive-compact'
              : 'tick--inactive';
          return (
            <div
              key={turn.id}
              style={{ top: `${(index / (turns.length - 1)) * 100}%` }}
              className={styles['trail-item']}
            >
              <Button
                variant="unstyled"
                onClick={() => scrollToTurn(turn.id)}
                aria-label={`Jump to message: ${turn.userText.slice(0, 60)}`}
                className={clsx(
                  styles['trail-button'],
                  isCompact ? styles['trail-button--compact'] : styles['trail-button--regular'],
                )}
              >
                <span className={clsx(styles.tick, styles[tickModifier])} />
              </Button>
              <div className={styles.tooltip}>
                <p className={styles['tooltip-title']}>{turn.userText}</p>
                {turn.assistantText && (
                  <p className={styles['tooltip-body']}>{turn.assistantText}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
