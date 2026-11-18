import { eq } from "drizzle-orm";
import { getDb, schema, type DB } from "@/lib/db";
import { buildDigestData, publishDigest, renderAutoDigest } from "@/lib/finance/digest";
import { decideActions } from "./schedule";
import { flushQueued, queuedCount, type Sender, type VapidDetails } from "./send";
import { chicagoParts } from "./time";

// One scheduler tick: look at the Chicago clock and the DB, do whatever is due. Safe to call every minute.
export async function schedulerTick(
  db: DB,
  now: number,
  opts: { sender?: Sender; vapid?: VapidDetails | null } = {},
): Promise<string[]> {
  const today = chicagoParts(now).day;
  const hasDigestToday = !!db.select({ day: schema.digests.day }).from(schema.digests).where(eq(schema.digests.day, today)).get();
  const actions = decideActions(now, { hasDigestToday, queuedCount: queuedCount(db) });
  const done: string[] = [];
  for (const a of actions) {
    if (a === "flush_queue") {
      await flushQueued(db, now, opts);
      done.push(a);
    } else {
      // 8:15 AM fallback: Claude has not posted, so store and push the numbers-only digest.
      await publishDigest(today, renderAutoDigest(buildDigestData(db, now)), "auto", { db, now });
      done.push(a);
    }
  }
  return done;
}

const g = globalThis as unknown as { __ownbankScheduler?: boolean };

// Starts the once-a-minute loop (idempotent; dev hot reload calls register again).
export function startScheduler() {
  if (g.__ownbankScheduler) return;
  g.__ownbankScheduler = true;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    schedulerTick(getDb(), Date.now())
      .catch((e) => console.error("scheduler tick failed:", e instanceof Error ? e.message : "unknown error"))
      .finally(() => {
        running = false;
      });
  }, 60_000);
  timer.unref();
}
