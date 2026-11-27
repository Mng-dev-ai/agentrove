import type { RateLimitStatus, RateLimitWindow, RateLimits } from '@/types/chat.types';
import type { ContextUsageTone } from '@/utils/contextUsage';

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly · all models',
  seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet',
};
const WINDOW_ORDER = Object.keys(WINDOW_LABELS);

const STATUS_TONES: Record<RateLimitStatus, ContextUsageTone> = {
  allowed: 'normal',
  allowed_warning: 'warning',
  rejected: 'danger',
};

export interface RateLimitRow {
  key: string;
  label: string;
  percentage: number | null;
  tone: ContextUsageTone;
  meta: string | null;
}

export interface RateLimitAction {
  label: string;
  tone: ContextUsageTone;
}

function windowRank(key: string): number {
  const index = WINDOW_ORDER.indexOf(key);
  return index === -1 ? WINDOW_ORDER.length : index;
}

function humanizeWindowKey(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatResetTime(resetsAt: Date, now: Date): string {
  const sameDay = resetsAt.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(undefined, {
    weekday: sameDay ? undefined : 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(resetsAt);
}

function statusPhrase(window: RateLimitWindow): string | null {
  if (window.status === 'rejected') return 'Limit reached';
  if (window.utilization !== null) return null;
  return window.status === 'allowed' ? 'Within limit' : 'Near limit';
}

function metaText(window: RateLimitWindow, now: Date): string | null {
  const phrase = statusPhrase(window);
  if (window.resets_at === null) return phrase;
  const reset = formatResetTime(new Date(window.resets_at * 1000), now);
  return phrase ? `${phrase} · resets ${reset}` : `Resets ${reset}`;
}

export function getRateLimitRows(rateLimits: RateLimits, now: Date): RateLimitRow[] {
  return Object.entries(rateLimits.windows)
    .filter(([, window]) => window.resets_at === null || window.resets_at * 1000 > now.getTime())
    .sort(([a], [b]) => windowRank(a) - windowRank(b))
    .map(([key, window]) => ({
      key,
      label: WINDOW_LABELS[key] ?? humanizeWindowKey(key),
      percentage:
        window.utilization === null
          ? null
          : Math.round(Math.min(Math.max(window.utilization, 0), 1) * 100),
      tone: STATUS_TONES[window.status],
      meta: metaText(window, now),
    }));
}

export function getRateLimitAction(
  rateLimits: RateLimits,
  rows: RateLimitRow[],
): RateLimitAction | null {
  if (rateLimits.is_using_overage) return { label: 'Extra usage', tone: 'warning' };
  if (rows.some((row) => row.tone === 'danger')) return { label: 'Limit reached', tone: 'danger' };
  if (rows.some((row) => row.tone === 'warning')) return { label: 'Near limit', tone: 'warning' };
  return null;
}
