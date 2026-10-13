/**
 * Local dates and times as plain strings: "YYYY-MM-DD", "HH:mm" and
 * "YYYY-MM-DDTHH:mm". The arithmetic is done in UTC so that it never moves
 * with the computer's time zone or daylight saving.
 */
const DAY = 86_400_000;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const isTime = (s: unknown): s is string => typeof s === "string" && HHMM.test(s);

export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** "YYYY-MM-DDTHH:mm" plus some hours. */
export function addHours(dateTime: string, hours: number): string {
  return new Date(Date.parse(`${dateTime}:00Z`) + hours * 3_600_000).toISOString().slice(0, 16);
}

/** "YYYY-MM-DDTHH:mm" in the computer's local time. */
export function localDateTime(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`;
}

/** Whole years between a birth date and a day. */
export function ageOn(birthDate: string, day: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Same day and month some years later (29 February becomes 28 February). */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split("-") as [string, string, string];
  const target = `${Number(y) + years}-${m}-${d}`;
  return isDate(target) ? target : `${Number(y) + years}-${m}-28`;
}

/** Hours from one local date-time to another (negative when already past). */
export const hoursBetween = (from: string, to: string): number => (Date.parse(`${to}:00Z`) - Date.parse(`${from}:00Z`)) / 3_600_000;
