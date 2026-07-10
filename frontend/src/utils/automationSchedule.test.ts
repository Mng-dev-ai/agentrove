import { describe, it, expect } from 'vitest';
import {
  buildCronExpression,
  parseCronExpression,
  describeCron,
  DEFAULT_SCHEDULE,
  type ScheduleForm,
} from './automationSchedule';

const form = (over: Partial<ScheduleForm>): ScheduleForm => ({ ...DEFAULT_SCHEDULE, ...over });

describe('buildCronExpression', () => {
  it('builds an hourly step expression ignoring time', () => {
    expect(buildCronExpression(form({ frequency: 'hourly', everyHours: 6 }))).toBe('0 */6 * * *');
  });

  it('builds a daily expression with minute then hour', () => {
    expect(buildCronExpression(form({ frequency: 'daily', time: '09:30' }))).toBe('30 9 * * *');
  });

  it('builds a weekly expression with the day-of-week in the last field', () => {
    expect(buildCronExpression(form({ frequency: 'weekly', time: '08:15', dayOfWeek: 1 }))).toBe(
      '15 8 * * 1',
    );
  });

  it('builds a monthly expression with the day-of-month in the third field', () => {
    expect(buildCronExpression(form({ frequency: 'monthly', time: '00:00', dayOfMonth: 15 }))).toBe(
      '0 0 15 * *',
    );
  });

  it('trims the raw cron for custom frequency', () => {
    expect(buildCronExpression(form({ frequency: 'custom', cron: '  5 4 * * *  ' }))).toBe(
      '5 4 * * *',
    );
  });

  it('falls back to 09:00 when the time string is unparseable', () => {
    expect(buildCronExpression(form({ frequency: 'daily', time: 'not-a-time' }))).toBe('0 9 * * *');
  });

  it('handles boundary hours 0 and 23', () => {
    expect(buildCronExpression(form({ frequency: 'daily', time: '00:00' }))).toBe('0 0 * * *');
    expect(buildCronExpression(form({ frequency: 'daily', time: '23:59' }))).toBe('59 23 * * *');
  });
});

describe('parseCronExpression', () => {
  it('parses an hourly step', () => {
    const parsed = parseCronExpression('0 */6 * * *');
    expect(parsed.frequency).toBe('hourly');
    expect(parsed.everyHours).toBe(6);
  });

  it('parses an every-hour step of 1', () => {
    expect(parseCronExpression('0 */1 * * *').everyHours).toBe(1);
  });

  it('leaves step >= 24 in custom mode (exceeds cron hour range)', () => {
    const parsed = parseCronExpression('0 */24 * * *');
    expect(parsed.frequency).toBe('custom');
    expect(parsed.cron).toBe('0 */24 * * *');
  });

  it('parses a daily expression back into HH:MM', () => {
    const parsed = parseCronExpression('30 9 * * *');
    expect(parsed.frequency).toBe('daily');
    expect(parsed.time).toBe('09:30');
  });

  it('parses a weekly expression with day-of-week and time', () => {
    const parsed = parseCronExpression('15 8 * * 1');
    expect(parsed.frequency).toBe('weekly');
    expect(parsed.dayOfWeek).toBe(1);
    expect(parsed.time).toBe('08:15');
  });

  it('normalizes Sunday-as-7 to 0', () => {
    expect(parseCronExpression('0 9 * * 7').dayOfWeek).toBe(0);
    expect(parseCronExpression('0 9 * * 0').dayOfWeek).toBe(0);
  });

  it('parses boundary weekdays 0 (Sunday) and 6 (Saturday)', () => {
    expect(parseCronExpression('0 9 * * 6').dayOfWeek).toBe(6);
  });

  it('parses a monthly expression with day-of-month', () => {
    const parsed = parseCronExpression('0 0 15 * *');
    expect(parsed.frequency).toBe('monthly');
    expect(parsed.dayOfMonth).toBe(15);
    expect(parsed.time).toBe('00:00');
  });

  it('falls back to custom for unrecognized shapes', () => {
    const parsed = parseCronExpression('*/5 1,2,3 * * *');
    expect(parsed.frequency).toBe('custom');
    expect(parsed.cron).toBe('*/5 1,2,3 * * *');
  });

  it('falls back to custom for empty input', () => {
    const parsed = parseCronExpression('');
    expect(parsed.frequency).toBe('custom');
    expect(parsed.cron).toBe('');
  });
});

describe('build/parse round-trips', () => {
  it('round-trips hourly', () => {
    const original = form({ frequency: 'hourly', everyHours: 4 });
    const parsed = parseCronExpression(buildCronExpression(original));
    expect(parsed.frequency).toBe('hourly');
    expect(parsed.everyHours).toBe(4);
  });

  it('round-trips daily', () => {
    const original = form({ frequency: 'daily', time: '07:45' });
    const parsed = parseCronExpression(buildCronExpression(original));
    expect(parsed.frequency).toBe('daily');
    expect(parsed.time).toBe('07:45');
  });

  it('round-trips weekly across every weekday', () => {
    for (let day = 0; day <= 6; day++) {
      const original = form({ frequency: 'weekly', time: '12:30', dayOfWeek: day });
      const parsed = parseCronExpression(buildCronExpression(original));
      expect(parsed.frequency).toBe('weekly');
      expect(parsed.dayOfWeek).toBe(day);
      expect(parsed.time).toBe('12:30');
    }
  });

  it('round-trips monthly', () => {
    const original = form({ frequency: 'monthly', time: '23:00', dayOfMonth: 28 });
    const parsed = parseCronExpression(buildCronExpression(original));
    expect(parsed.frequency).toBe('monthly');
    expect(parsed.dayOfMonth).toBe(28);
    expect(parsed.time).toBe('23:00');
  });

  it('round-trips a custom cron unchanged', () => {
    const original = form({ frequency: 'custom', cron: '0 0 1 1 *' });
    const parsed = parseCronExpression(buildCronExpression(original));
    expect(parsed.frequency).toBe('custom');
    expect(parsed.cron).toBe('0 0 1 1 *');
  });
});

describe('describeCron', () => {
  it('describes an every-hour schedule in the singular', () => {
    expect(describeCron('0 */1 * * *')).toBe('Every hour');
  });

  it('describes a multi-hour step in the plural', () => {
    expect(describeCron('0 */6 * * *')).toBe('Every 6 hours');
  });

  it('describes a daily schedule', () => {
    expect(describeCron('30 9 * * *')).toBe('Daily at 09:30');
  });

  it('describes a weekly schedule with the weekday label', () => {
    expect(describeCron('15 8 * * 1')).toBe('Mondays at 08:15');
    expect(describeCron('0 9 * * 0')).toBe('Sundays at 09:00');
    expect(describeCron('0 9 * * 6')).toBe('Saturdays at 09:00');
  });

  it('describes a monthly schedule', () => {
    expect(describeCron('0 0 15 * *')).toBe('Monthly on day 15 at 00:00');
  });

  it('returns the raw cron for custom shapes', () => {
    expect(describeCron('*/5 1,2,3 * * *')).toBe('*/5 1,2,3 * * *');
  });
});
