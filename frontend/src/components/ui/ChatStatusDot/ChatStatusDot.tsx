import clsx from 'clsx';
import type { ChatStatusTone } from '@/utils/message';
import styles from './ChatStatusDot.module.scss';

// red+ping=needs you, amber=running (compact; usually spinner), green=done, blue=unread
const TONE_STYLE: Record<ChatStatusTone, { tone: ChatStatusTone; ping: boolean }> = {
  blocked: { tone: 'blocked', ping: true },
  running: { tone: 'running', ping: false },
  completed: { tone: 'completed', ping: false },
  unread: { tone: 'unread', ping: false },
};

// ringClassName punches the dot out from an overlayed icon.
export function ChatStatusDot({
  tone,
  className,
  ringClassName,
}: {
  tone: ChatStatusTone;
  className?: string;
  ringClassName?: string;
}) {
  const { tone: toneKey, ping } = TONE_STYLE[tone];
  return (
    <span className={clsx(styles['chat-status-dot'], className)}>
      {/* Inner box sizes the ping/ring independent of outer positioning. */}
      <span className={styles['dot-inner']}>
        {ping && <span className={clsx(styles.ping, styles[`dot--${toneKey}`])} />}
        <span className={clsx(styles['dot-ring'], ringClassName, styles[`dot--${toneKey}`])} />
      </span>
    </span>
  );
}
