// Pure helpers for YYYY-MM-DD strings (calendar math in UTC so there is no DST drift).

export function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

export function fromDayNumber(n: number): string {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

export function shiftDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

// First day of the month `delta` months away (delta may be negative).
export function addMonthsStart(date: string, delta: number): string {
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + delta, 1));
  return d.toISOString().slice(0, 10);
}

// Same day-of-month in the month `delta` away, clamped to that month's last day (Mar 31 -> Feb 28).
export function sameDayInMonth(date: string, delta: number): string {
  const start = addMonthsStart(date, delta);
  const day = Math.min(Number(date.slice(8, 10)), Number(monthEnd(start).slice(8, 10)));
  return `${start.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}
