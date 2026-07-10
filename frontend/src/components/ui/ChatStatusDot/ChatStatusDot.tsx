import clsx from 'clsx';
import styles from './ChatStatusDot.module.scss';

export type ChatStatusTone = 'blocked' | 'running' | 'completed' | 'unread';

// Precedence for a chat's status tone (shared by the sidebar rows and sub-threads):
// needs-you > running > done > unread. Running normally renders the spinner, not a dot.
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

// Shared status dot for the sidebar rows and the title-bar tabs so both read the
// same: red (pulsing) = needs you, amber = running, green = done, blue = unread.
// (Running normally shows the braille spinner; the amber dot is its compact form.)
const TONE_STYLE: Record<ChatStatusTone, { tone: ChatStatusTone; ping: boolean }> = {
  blocked: { tone: 'blocked', ping: true },
  running: { tone: 'running', ping: false },
  completed: { tone: 'completed', ping: false },
  unread: { tone: 'unread', ping: false },
};

// className positions the whole dot (e.g. absolute corner overlay, or a sizing box
// to center it); ringClassName punches it out from an icon it overlays.
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
      {/* Inner box owns the ping's positioning context so the ring stays dot-sized
          regardless of how the outer span is positioned. */}
      <span className={styles['dot-inner']}>
        {ping && <span className={clsx(styles.ping, styles[`dot--${toneKey}`])} />}
        <span className={clsx(styles['dot-ring'], ringClassName, styles[`dot--${toneKey}`])} />
      </span>
    </span>
  );
}
