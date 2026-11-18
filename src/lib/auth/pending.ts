import { randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { getDb, schema, type DB } from "@/lib/db";
import { hashToken } from "./session";

export const PENDING_COOKIE = "ob_pending";
export const PENDING_TTL_MS = 5 * 60 * 1000;

export type PendingLogin = { idHash: string; userId: number; next: string | null; userAgent: string | null };

// Only same-site absolute paths are allowed as a return target (no scheme, no //host, no backslashes).
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\r\n]/.test(value)) return null;
  if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login/")) return null;
  return value;
}

export function createPendingLogin(
  userId: number,
  next: string | null,
  userAgent: string | null,
  db: DB = getDb(),
  now = Date.now(),
): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + PENDING_TTL_MS;
  db.insert(schema.pendingLogins)
    .values({ idHash: hashToken(token), userId, next, userAgent: userAgent?.slice(0, 300) ?? null, createdAt: now, expiresAt })
    .run();
  db.delete(schema.pendingLogins).where(lt(schema.pendingLogins.expiresAt, now)).run();
  return { token, expiresAt };
}

export function getPendingLogin(token: string | undefined, db: DB = getDb(), now = Date.now()): PendingLogin | null {
  if (!token || token.length > 200) return null;
  const idHash = hashToken(token);
  const row = db.select().from(schema.pendingLogins).where(eq(schema.pendingLogins.idHash, idHash)).get();
  if (!row) return null;
  if (row.expiresAt <= now) {
    db.delete(schema.pendingLogins).where(eq(schema.pendingLogins.idHash, idHash)).run();
    return null;
  }
  return { idHash, userId: row.userId, next: row.next, userAgent: row.userAgent };
}

export function deletePendingLogin(idHash: string, db: DB = getDb()) {
  db.delete(schema.pendingLogins).where(eq(schema.pendingLogins.idHash, idHash)).run();
}
