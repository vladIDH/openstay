/**
 * Calendar-date helpers. Dates are plain ISO strings (YYYY-MM-DD) with no time
 * zone: a "night" is identified by the date the guest sleeps there. Internally
 * dates become day numbers (days since 1970-01-01, UTC) so arithmetic is exact.
 */

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_DAY = /^(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** "MM-DD", valid in a leap year (so "02-29" is accepted). */
export function isMonthDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = MONTH_DAY.exec(value);
  if (!m) return false;
  return isIsoDate(`2000-${m[1]}-${m[2]}`);
}

export function toDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

export function fromDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function weekdayOf(day: number): Weekday {
  // 1970-01-01 was a Thursday (index 3 in WEEKDAYS).
  return WEEKDAYS[(((day + 3) % 7) + 7) % 7] as Weekday;
}

/** "MM-DD" of a day number. */
export function monthDayOf(day: number): string {
  return fromDay(day).slice(5);
}

/** First and last day number of the month that contains `day`. */
export function monthBounds(day: number): { first: number; last: number } {
  const d = new Date(day * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return {
    first: Date.UTC(y, m, 1) / MS_PER_DAY,
    last: Date.UTC(y, m + 1, 0) / MS_PER_DAY,
  };
}

/**
 * Does a yearly recurring period [start, end] (both "MM-DD", inclusive) contain
 * the given "MM-DD"? Periods may wrap around the new year (e.g. 12-20 → 01-06).
 */
export function inRecurringPeriod(monthDay: string, start: string, end: string): boolean {
  if (start <= end) return start <= monthDay && monthDay <= end;
  return monthDay >= start || monthDay <= end;
}
