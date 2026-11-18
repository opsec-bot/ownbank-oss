import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema, type DB } from "@/lib/db";

// Fixed-window counter in the rate_limits table. Returns false once `max` hits are used in the current window.
export function allowHit(key: string, windowMs: number, max: number, db: DB = getDb(), now = Date.now()): boolean {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  db.delete(schema.rateLimits)
    .where(and(eq(schema.rateLimits.key, key), lt(schema.rateLimits.windowStart, windowStart)))
    .run();
  const row = db
    .insert(schema.rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [schema.rateLimits.key, schema.rateLimits.windowStart],
      set: { count: sql`${schema.rateLimits.count} + 1` },
    })
    .returning({ count: schema.rateLimits.count })
    .get();
  return row.count <= max;
}
