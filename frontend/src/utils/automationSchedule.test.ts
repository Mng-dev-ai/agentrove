import { describe, it, expect } from 'vitest';
import {
  buildCronExpression,
  parseCronExpression,
  describeCron,
  DEFAULT_SCHEDULE,
  type ScheduleForm,
} from './automationSchedule';

const form = (over: Partial<ScheduleForm>): ScheduleForm => ({ ...DEFAULT_SCHEDULE, ...over });

const SHAPES: [string, ScheduleForm, string][] = [
  ['hourly', form({ frequency: 'hourly', everyHours: 4 }), '0 */4 * * *'],
  ['daily', form({ frequency: 'daily', time: '07:45' }), '45 7 * * *'],
  ['weekly', form({ frequency: 'weekly', time: '08:15', dayOfWeek: 1 }), '15 8 * * 1'],
  ['monthly', form({ frequency: 'monthly', time: '00:00', dayOfMonth: 15 }), '0 0 15 * *'],
  ['custom', form({ frequency: 'custom', cron: '0 0 1 1 *' }), '0 0 1 1 *'],
];

describe('buildCronExpression / parseCronExpression', () => {
  it.each(SHAPES)('builds and parses back a %s schedule', (_label, schedule, cron) => {
    expect(buildCronExpression(schedule)).toBe(cron);
    expect(parseCronExpression(cron)).toEqual(schedule);
  });

  it('trims the raw cron for custom frequency', () => {
    expect(buildCronExpression(form({ frequency: 'custom', cron: '  5 4 * * *  ' }))).toBe(
      '5 4 * * *',
    );
  });

  it('falls back to 09:00 when the time string is unparseable', () => {
    expect(buildCronExpression(form({ frequency: 'daily', time: 'not-a-time' }))).toBe('0 9 * * *');
  });

  it('normalizes Sunday-as-7 to 0', () => {
    expect(parseCronExpression('0 9 * * 7').dayOfWeek).toBe(0);
  });

  it.each(['0 */24 * * *', '*/5 1,2,3 * * *', ''])(
    'keeps %j in custom mode with the raw expression',
    (cron) => {
      expect(parseCronExpression(cron)).toEqual(form({ frequency: 'custom', cron }));
    },
  );
});

describe('describeCron', () => {
  it.each([
    ['0 */1 * * *', 'Every hour'],
    ['0 */6 * * *', 'Every 6 hours'],
    ['30 9 * * *', 'Daily at 09:30'],
    ['15 8 * * 1', 'Mondays at 08:15'],
    ['0 9 * * 7', 'Sundays at 09:00'],
    ['0 0 15 * *', 'Monthly on day 15 at 00:00'],
    ['0 */24 * * *', '0 */24 * * *'],
    ['*/5 1,2,3 * * *', '*/5 1,2,3 * * *'],
  ])('describes %j as %j', (cron, label) => {
    expect(describeCron(cron)).toBe(label);
  });
});
