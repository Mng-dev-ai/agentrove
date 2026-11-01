import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatRelativeTime, getRelativeTime, formatDuration } from './date';

const NOW = new Date('2026-07-11T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('formatRelativeTime', () => {
  it.each([
    [30 * SECOND, 'just now'],
    [MINUTE, '1 minute ago'],
    [5 * MINUTE, '5 minutes ago'],
    [HOUR, '1 hour ago'],
    [3 * HOUR, '3 hours ago'],
    [DAY, 'yesterday'],
    [6 * DAY, '6 days ago'],
  ])('formats %ims ago as %j', (ms, label) => {
    expect(formatRelativeTime(ago(ms))).toBe(label);
  });

  it('accepts an ISO string input', () => {
    expect(formatRelativeTime(ago(5 * MINUTE).toISOString())).toBe('5 minutes ago');
  });

  it('falls back to an absolute date beyond a week, showing the year only when it differs', () => {
    const sameYear = formatRelativeTime(ago(10 * DAY));
    const otherYear = formatRelativeTime(new Date('2025-01-15T12:00:00.000Z'));

    expect(sameYear).not.toMatch(/ago|yesterday/);
    expect(sameYear).not.toContain('2026');
    expect(otherYear).toContain('2025');
  });
});

describe('getRelativeTime', () => {
  it.each([
    [30 * SECOND, 'now'],
    [5 * MINUTE, '5m'],
    [2 * HOUR, '2h'],
    [6 * DAY, '6d'],
    [7 * DAY, '1w'],
    [14 * DAY, '2w'],
    [40 * DAY, '1mo'],
  ])('formats %ims ago as %j', (ms, label) => {
    expect(getRelativeTime(ago(ms).toISOString())).toBe(label);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [59_499, '59s'],
    [59_500, '1m 0s'],
    [65_000, '1m 5s'],
    [90_000, '1m 30s'],
  ])('formats %ims as %j', (ms, label) => {
    expect(formatDuration(ms)).toBe(label);
  });
});
