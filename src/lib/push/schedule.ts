import { chicagoParts, isQuietHours } from "./time";

export const AUTO_DIGEST_MINUTE = 8 * 60 + 15; // 8:15 AM Chicago
export const AUTO_DIGEST_CUTOFF_MINUTE = 12 * 60; // catch-up window ends at noon (server was down at 8:15)

export type ScheduleState = {
  hasDigestToday: boolean; // any digests row for today (claude or auto)
  queuedCount: number; // notifications waiting out quiet hours
};

export type ScheduleAction = "flush_queue" | "auto_digest";

// Pure: what the once-a-minute scheduler should do at this moment.
// 7:00 AM and later: flush anything queued overnight. 8:15 AM: generate the auto digest if none exists for today
// (Claude's digest posted through MCP counts). Runs until noon so a restart at 8:20 still catches up.
export function decideActions(now: number, state: ScheduleState): ScheduleAction[] {
  const out: ScheduleAction[] = [];
  const { hour, minute } = chicagoParts(now);
  const mins = hour * 60 + minute;
  if (!isQuietHours(now) && state.queuedCount > 0) out.push("flush_queue");
  if (mins >= AUTO_DIGEST_MINUTE && mins < AUTO_DIGEST_CUTOFF_MINUTE && !state.hasDigestToday) out.push("auto_digest");
  return out;
}
