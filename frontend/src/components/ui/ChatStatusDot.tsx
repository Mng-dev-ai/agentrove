import { cn } from '@/utils/cn';

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
const TONE_STYLE: Record<ChatStatusTone, { color: string; ping: boolean }> = {
  blocked: { color: 'bg-error-500', ping: true },
  running: { color: 'bg-warning-500', ping: false },
  completed: { color: 'bg-success-500', ping: false },
  unread: { color: 'bg-info-500', ping: false },
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
  const { color, ping } = TONE_STYLE[tone];
  return (
    <span className={cn('flex h-2 w-2', className)}>
      {/* Inner box owns the ping's positioning context so the ring stays dot-sized
          regardless of how the outer span is positioned. */}
      <span className="relative flex h-2 w-2">
        {ping && (
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
              color,
            )}
          />
        )}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', ringClassName, color)} />
      </span>
    </span>
  );
}
