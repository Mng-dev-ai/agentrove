// Builds/parses the restricted cron shapes the automation schedule UI offers.
// Anything the parser doesn't recognize round-trips through the 'custom' mode.

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

export interface ScheduleForm {
  frequency: ScheduleFrequency;
  everyHours: number;
  time: string; // "HH:MM"
  dayOfWeek: number; // 0 = Sunday, matching cron
  dayOfMonth: number;
  cron: string;
}

export const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const DEFAULT_SCHEDULE: ScheduleForm = {
  frequency: 'daily',
  everyHours: 6,
  time: '09:00',
  dayOfWeek: 1,
  dayOfMonth: 1,
  cron: '',
};

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
const EVERY_HOURS_PATTERN = /^0 \*\/(\d{1,3}) \* \* \*$/;
const DAILY_PATTERN = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;
const WEEKLY_PATTERN = /^(\d{1,2}) (\d{1,2}) \* \* (\d)$/;
const MONTHLY_PATTERN = /^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \*$/;

function splitTime(time: string): { hour: number; minute: number } {
  const match = TIME_PATTERN.exec(time);
  if (!match) return { hour: 9, minute: 0 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function buildCronExpression(schedule: ScheduleForm): string {
  const { hour, minute } = splitTime(schedule.time);
  switch (schedule.frequency) {
    case 'hourly':
      return `0 */${schedule.everyHours} * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${schedule.dayOfWeek}`;
    case 'monthly':
      return `${minute} ${hour} ${schedule.dayOfMonth} * *`;
    case 'custom':
      return schedule.cron.trim();
  }
}

export function parseCronExpression(cron: string): ScheduleForm {
  const hourly = EVERY_HOURS_PATTERN.exec(cron);
  // Steps ≥ 24 exceed cron's 0-23 hour range (they collapse to daily) — leave
  // them in custom mode so the label stays honest and re-saves don't clamp them.
  if (hourly && Number(hourly[1]) <= 23) {
    return { ...DEFAULT_SCHEDULE, frequency: 'hourly', everyHours: Number(hourly[1]) };
  }
  const daily = DAILY_PATTERN.exec(cron);
  if (daily) {
    return {
      ...DEFAULT_SCHEDULE,
      frequency: 'daily',
      time: `${pad(Number(daily[2]))}:${pad(Number(daily[1]))}`,
    };
  }
  const weekly = WEEKLY_PATTERN.exec(cron);
  if (weekly) {
    return {
      ...DEFAULT_SCHEDULE,
      frequency: 'weekly',
      time: `${pad(Number(weekly[2]))}:${pad(Number(weekly[1]))}`,
      // Cron allows Sunday as both 0 and 7 — normalize so labels/selects work.
      dayOfWeek: Number(weekly[3]) % 7,
    };
  }
  const monthly = MONTHLY_PATTERN.exec(cron);
  if (monthly) {
    return {
      ...DEFAULT_SCHEDULE,
      frequency: 'monthly',
      time: `${pad(Number(monthly[2]))}:${pad(Number(monthly[1]))}`,
      dayOfMonth: Number(monthly[3]),
    };
  }
  return { ...DEFAULT_SCHEDULE, frequency: 'custom', cron };
}

export function describeCron(cron: string): string {
  const schedule = parseCronExpression(cron);
  switch (schedule.frequency) {
    case 'hourly':
      return schedule.everyHours === 1 ? 'Every hour' : `Every ${schedule.everyHours} hours`;
    case 'daily':
      return `Daily at ${schedule.time}`;
    case 'weekly':
      return `${WEEKDAY_LABELS[schedule.dayOfWeek]}s at ${schedule.time}`;
    case 'monthly':
      return `Monthly on day ${schedule.dayOfMonth} at ${schedule.time}`;
    case 'custom':
      return cron;
  }
}
