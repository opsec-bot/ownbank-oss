// App-timezone clock helpers (APP_TIMEZONE, default America/Chicago). The "chicago" names are historical. Pure: take a timestamp, no globals.
import { APP_TIMEZONE } from "@/lib/timezone";

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type ChicagoParts = { day: string; hour: number; minute: number };

export function chicagoParts(now: number): ChicagoParts {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(now))) p[part.type] = part.value;
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

export const QUIET_START_HOUR = 22; // 10 PM
export const QUIET_END_HOUR = 7; // 7 AM

// No pushes from 10 PM until 7 AM app time.
export function isQuietHours(now: number): boolean {
  const h = chicagoParts(now).hour;
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}
