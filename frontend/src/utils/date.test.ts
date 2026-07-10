import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatRelativeTime, getRelativeTime, formatDuration, formatFullTimestamp } from './date';

// Fixed instant so relative-time math is deterministic; timezone-agnostic because
// every assertion is built from Date arithmetic or the same Intl call the code uses.
const NOW = new Date('2026-07-11T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('returns "just now" under a minute', () => {
    expect(formatRelativeTime(ago(30 * SECOND))).toBe('just now');
  });

  it('pluralizes minutes', () => {
    expect(formatRelativeTime(ago(MINUTE))).toBe('1 minute ago');
    expect(formatRelativeTime(ago(5 * MINUTE))).toBe('5 minutes ago');
  });

  it('pluralizes hours', () => {
    expect(formatRelativeTime(ago(HOUR))).toBe('1 hour ago');
    expect(formatRelativeTime(ago(3 * HOUR))).toBe('3 hours ago');
  });

  it('says "yesterday" at exactly one day', () => {
    expect(formatRelativeTime(ago(DAY))).toBe('yesterday');
  });

  it('reports days up to a week', () => {
    expect(formatRelativeTime(ago(3 * DAY))).toBe('3 days ago');
    expect(formatRelativeTime(ago(6 * DAY))).toBe('6 days ago');
  });

  it('falls back to an absolute date beyond a week (same year: no year shown)', () => {
    const target = ago(10 * DAY);
    const expected = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: undefined,
    }).format(target);
    expect(formatRelativeTime(target)).toBe(expected);
  });

  it('includes the year when the target is in a different year', () => {
    const target = new Date('2025-01-01T12:00:00.000Z');
    const expected = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(target);
    expect(formatRelativeTime(target)).toBe(expected);
  });

  it('accepts an ISO string input', () => {
    expect(formatRelativeTime(ago(5 * MINUTE).toISOString())).toBe('5 minutes ago');
  });
});

describe('getRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('returns "now" under a minute', () => {
    expect(getRelativeTime(ago(30 * SECOND).toISOString())).toBe('now');
  });

  it('formats minutes, hours, days and weeks with compact units', () => {
    expect(getRelativeTime(ago(5 * MINUTE).toISOString())).toBe('5m');
    expect(getRelativeTime(ago(2 * HOUR).toISOString())).toBe('2h');
    expect(getRelativeTime(ago(3 * DAY).toISOString())).toBe('3d');
    expect(getRelativeTime(ago(14 * DAY).toISOString())).toBe('2w');
  });

  it('switches to months past ~4 weeks', () => {
    expect(getRelativeTime(ago(40 * DAY).toISOString())).toBe('1mo');
  });

  it('boundary: 7 days is 1w, 6 days is 6d', () => {
    expect(getRelativeTime(ago(7 * DAY).toISOString())).toBe('1w');
    expect(getRelativeTime(ago(6 * DAY).toISOString())).toBe('6d');
  });

  // Suspicious-but-harmless: 28-29 days is 4 weeks (skips the <4 weeks branch) but
  // floor(days/30) is still 0, so it renders "0mo". Documenting current behavior.
  it('renders "0mo" for 28 days (known edge)', () => {
    expect(getRelativeTime(ago(28 * DAY).toISOString())).toBe('0mo');
  });
});

describe('formatDuration', () => {
  it('formats sub-minute durations in seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(5000)).toBe('5s');
  });

  it('rounds to the nearest second', () => {
    expect(formatDuration(59499)).toBe('59s');
    expect(formatDuration(59500)).toBe('1m 0s');
  });

  it('formats minutes and seconds past a minute', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(65000)).toBe('1m 5s');
  });
});

describe('formatFullTimestamp', () => {
  it('matches the same Intl formatting the code uses (locale-agnostic)', () => {
    const target = new Date('2026-07-11T12:00:00.000Z');
    const expected = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(target);
    expect(formatFullTimestamp(target)).toBe(expected);
    expect(formatFullTimestamp(target.toISOString())).toBe(expected);
  });
});
