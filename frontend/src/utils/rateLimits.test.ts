import { describe, expect, it } from 'vitest';
import type { RateLimitWindow, RateLimits } from '@/types/chat.types';
import { getRateLimitAction, getRateLimitRows } from './rateLimits';

const NOW = new Date('2026-11-27T12:00:00');
const IN_ONE_HOUR = NOW.getTime() / 1000 + 3600;

function windowWith(overrides: Partial<RateLimitWindow> = {}): RateLimitWindow {
  return { utilization: 0.5, resets_at: IN_ONE_HOUR, status: 'allowed', ...overrides };
}

function limits(windows: Record<string, RateLimitWindow>, isUsingOverage = false): RateLimits {
  return { windows, is_using_overage: isUsingOverage };
}

describe('getRateLimitRows', () => {
  it('orders known windows first and humanises unknown keys', () => {
    const rows = getRateLimitRows(
      limits({
        seven_day_new_model: windowWith(),
        seven_day_overage_included: windowWith(),
        seven_day_sonnet: windowWith(),
        seven_day: windowWith(),
        five_hour: windowWith(),
        seven_day_opus: windowWith(),
      }),
      NOW,
    );
    expect(rows.map((row) => row.label)).toEqual([
      '5-hour limit',
      'Weekly · all models',
      'Weekly · Opus',
      'Weekly · Sonnet',
      'Weekly · Fable',
      'Seven day new model',
    ]);
  });

  it('maps status to tone and prefixes a reached limit', () => {
    const rows = getRateLimitRows(
      limits({
        five_hour: windowWith({ status: 'allowed', utilization: 0.614 }),
        seven_day: windowWith({ status: 'allowed_warning' }),
        seven_day_opus: windowWith({ status: 'rejected', utilization: 1 }),
      }),
      NOW,
    );
    expect(rows.map((row) => [row.tone, row.percentage])).toEqual([
      ['normal', 61],
      ['warning', 50],
      ['danger', 100],
    ]);
    expect(rows[0].meta).toMatch(/^Resets \d/);
    expect(rows[2].meta).toMatch(/^Limit reached · resets \d/);
  });

  it('shows only a status line when utilization is unknown', () => {
    const [row] = getRateLimitRows(limits({ seven_day: windowWith({ utilization: null }) }), NOW);
    expect(row.percentage).toBeNull();
    expect(row.meta).toMatch(/^Within limit · resets /);
  });

  it('drops windows whose reset has passed', () => {
    const rows = getRateLimitRows(
      limits({
        five_hour: windowWith({ resets_at: NOW.getTime() / 1000 - 1 }),
        seven_day: windowWith(),
      }),
      NOW,
    );
    expect(rows.map((row) => row.key)).toEqual(['seven_day']);
  });
});

describe('getRateLimitAction', () => {
  function actionFor(rateLimits: RateLimits) {
    return getRateLimitAction(rateLimits, getRateLimitRows(rateLimits, NOW))?.label ?? null;
  }

  it('prefers extra usage, then a reached limit, then a near limit', () => {
    const rejected = {
      a: windowWith({ status: 'rejected' }),
      b: windowWith({ status: 'allowed_warning' }),
    };
    expect(actionFor(limits(rejected, true))).toBe('Extra usage');
    expect(actionFor(limits(rejected))).toBe('Limit reached');
    expect(actionFor(limits({ b: windowWith({ status: 'allowed_warning' }) }))).toBe('Near limit');
    expect(actionFor(limits({ c: windowWith() }))).toBeNull();
  });
});
