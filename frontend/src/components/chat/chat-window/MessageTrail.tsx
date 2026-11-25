import { memo, useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { isAssistantMessage } from '@/utils/message';
import type { Message } from '@/types/chat.types';
import styles from './MessageTrail.module.scss';

// Cap preview text so a huge message doesn't dump megabytes into the DOM
const PREVIEW_MAX_CHARS = 200;
const TICK_SPACING_PX = 12;
const ACTIVE_VIEWPORT_FRACTION = 0.4;

interface TrailTurn {
  id: string;
  userText: string;
  assistantText: string;
}

export type TrailMessage = Pick<Message, 'id' | 'content_text' | 'role' | 'is_bot'>;

interface MessageTrailProps {
  messages: TrailMessage[];
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

  // Previews change on every stream flush; the scroll tracking below only needs
  // the ids, so key it on them to avoid re-measuring every turn per flush.
  const turnIdsKey = turns.map((turn) => turn.id).join('\n');
  const turnIds = useMemo(() => (turnIdsKey ? turnIdsKey.split('\n') : []), [turnIdsKey]);

  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || turnIds.length === 0) return;

    const updateActive = () => {
      // Active turn = last user message whose top has crossed the upper part of
      // the viewport, so the tick tracks what the user is currently reading.
      const scrollerTop = scroller.getBoundingClientRect().top;
      const threshold = scroller.clientHeight * ACTIVE_VIEWPORT_FRACTION;
      const rows = new Map<string, Element>();
      for (const el of scroller.querySelectorAll('[data-message-id]')) {
        const id = el.getAttribute('data-message-id');
        if (id !== null && !rows.has(id)) rows.set(id, el);
      }
      let current = turnIds[0];
      for (const id of turnIds) {
        const el = rows.get(id);
        if (el && el.getBoundingClientRect().top - scrollerTop <= threshold) {
          current = id;
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
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollerRef, turnIds]);

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
                className={styles['trail-button']}
              >
                <span
                  className={clsx(
                    styles.tick,
                    styles[isActive ? 'tick--active' : 'tick--inactive'],
                  )}
                />
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
