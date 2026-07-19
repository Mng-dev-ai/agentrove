import clsx from 'clsx';
import styles from './ChatStatusDot.module.scss';

export type ChatStatusTone = 'blocked' | 'running' | 'completed' | 'unread';

// Precedence: needs-you > running > done > unread (running uses the spinner, not a dot).
export function chatStatusTone(flags: {
  blocked: boolean;
  streaming: boolean;
  completed: boolean;
  unread?: boolean;
}): ChatStatusTone | null {
  if (flags.blocked) return 'blocked';
  if (flags.streaming) return 'running';
  if (flags.completed) return 'completed';
  if (flags.unread) return 'unread';
  return null;
}

export const CHAT_STATUS_LABEL: Record<ChatStatusTone, string> = {
  blocked: 'Needs you',
  running: 'Running',
  completed: 'Done',
  unread: 'Unread',
};

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
