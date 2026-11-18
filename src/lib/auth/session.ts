import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { getDb, schema, type DB } from "@/lib/db";
import { SESSION_REFRESH_AFTER_MS, SESSION_TTL_MS } from "./cookie";

export type SessionUser = { id: number; email: string };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Returns the raw token (goes in the cookie). Only its SHA-256 is stored.
export function createSession(
  userId: number,
  userAgent: string | null,
  db: DB = getDb(),
  now = Date.now(),
): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_MS;
  db.insert(schema.sessions)
    .values({ idHash: hashToken(token), userId, expiresAt, createdAt: now, userAgent: userAgent?.slice(0, 300) ?? null })
    .run();
  db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)).run();
  return { token, expiresAt };
}

// Valid token -> user, and slides the expiry forward when it is more than a day old.
export function validateSession(token: string | undefined, db: DB = getDb(), now = Date.now()): SessionUser | null {
  if (!token || token.length > 200) return null;
  const idHash = hashToken(token);
  const row = db
    .select({
      expiresAt: schema.sessions.expiresAt,
      id: schema.users.id,
      email: schema.users.email,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.idHash, idHash))
    .get();
  if (!row) return null;
  if (row.expiresAt <= now) {
    db.delete(schema.sessions).where(eq(schema.sessions.idHash, idHash)).run();
    return null;
  }
  if (row.expiresAt - now < SESSION_TTL_MS - SESSION_REFRESH_AFTER_MS) {
    db.update(schema.sessions)
      .set({ expiresAt: now + SESSION_TTL_MS })
      .where(eq(schema.sessions.idHash, idHash))
      .run();
  }
  return { id: row.id, email: row.email };
}

export function deleteSession(token: string | undefined, db: DB = getDb()) {
  if (!token) return;
  db.delete(schema.sessions).where(eq(schema.sessions.idHash, hashToken(token))).run();
}
