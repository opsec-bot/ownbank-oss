// The one timezone the app thinks in (dates, quiet hours, digests). Set APP_TIMEZONE to an IANA name.
// No "server-only" here: scripts and instrumentation load this too.

export const DEFAULT_TIMEZONE = "America/Chicago";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Reads APP_TIMEZONE. Empty means the default; an invalid name falls back to the default with a warning.
export function resolveTimezone(raw: string | undefined = process.env.APP_TIMEZONE): string {
  const tz = (raw ?? "").trim();
  if (!tz) return DEFAULT_TIMEZONE;
  if (isValidTimezone(tz)) return tz;
  console.warn(`APP_TIMEZONE "${tz}" is not a valid IANA timezone, using ${DEFAULT_TIMEZONE}`);
  return DEFAULT_TIMEZONE;
}

export const APP_TIMEZONE = resolveTimezone();

// Short readable name for user-visible text: "CT", "ET", or the IANA name when Intl has nothing short.
export function zoneLabel(tz: string = APP_TIMEZONE): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortGeneric" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    if (part && !part.value.startsWith("GMT")) return part.value;
  } catch {
    // fall through
  }
  return tz;
}
