import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema, type DB } from "@/lib/db";
import { createPendingLogin, deletePendingLogin, getPendingLogin, safeNext } from "./pending";
import { verifyDummy, verifyPassword } from "./password";
import { createSession } from "./session";
import { checkSecondFactor, totpState } from "./totp";

export const MAX_FAILED = 5;
export const WINDOW_MS = 15 * 60 * 1000;

export const GENERIC_ERROR = "Invalid email or password";
export const LOCKED_ERROR = "Too many attempts, try again later";
export const BAD_CODE_ERROR = "That code did not work";
export const EXPIRED_ERROR = "That sign-in expired. Start again.";

export type LoginResult =
  | { ok: true; needsTotp: false; token: string; expiresAt: number; next: string | null }
  | { ok: true; needsTotp: true; pendingToken: string; expiresAt: number }
  | { ok: false; error: typeof GENERIC_ERROR | typeof LOCKED_ERROR };

export type VerifyResult =
  | { ok: true; token: string; expiresAt: number; next: string | null }
  | { ok: false; error: typeof BAD_CODE_ERROR | typeof LOCKED_ERROR | typeof EXPIRED_ERROR };

function failedCount(db: DB, key: string, now: number): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.loginAttempts)
    .where(and(eq(schema.loginAttempts.key, key), gt(schema.loginAttempts.at, now - WINDOW_MS)))
    .get();
  return row?.n ?? 0;
}

function isLocked(db: DB, ipKey: string, emailKey: string, now: number): boolean {
  return failedCount(db, ipKey, now) >= MAX_FAILED || failedCount(db, emailKey, now) >= MAX_FAILED;
}

function recordFailure(db: DB, ipKey: string, emailKey: string, now: number) {
  db.insert(schema.loginAttempts)
    .values([
      { key: ipKey, at: now },
      { key: emailKey, at: now },
    ])
    .run();
  db.delete(schema.loginAttempts).where(lt(schema.loginAttempts.at, now - WINDOW_MS)).run();
}

export async function attemptLogin(
  input: { email: string; password: string; ip: string; userAgent: string | null; next?: string | null },
  db: DB = getDb(),
  now = Date.now(),
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase().slice(0, 254);
  const ipKey = `ip:${input.ip.slice(0, 64)}`;
  const emailKey = `email:${email}`;
  const next = safeNext(input.next);

  if (isLocked(db, ipKey, emailKey, now)) return { ok: false, error: LOCKED_ERROR };

  const user = email ? db.select().from(schema.users).where(eq(schema.users.email, email)).get() : undefined;
  // Unknown email: still burn a password verification so timing does not reveal which emails exist.
  const valid = user ? await verifyPassword(user.passwordHash, input.password) : await verifyDummy(input.password);

  if (!user || !valid) {
    recordFailure(db, ipKey, emailKey, now);
    return { ok: false, error: GENERIC_ERROR };
  }

  // With 2FA on, the password alone proves nothing yet: do NOT clear the failure counters here (otherwise anyone who
  // knows the password could reset the code-guess lockout by re-entering it). They clear after the code is accepted.
  if (totpState(user) === "on") {
    const p = createPendingLogin(user.id, next, input.userAgent, db, now);
    return { ok: true, needsTotp: true, pendingToken: p.token, expiresAt: p.expiresAt };
  }

  db.delete(schema.loginAttempts).where(inArray(schema.loginAttempts.key, [emailKey])).run();
  const { token, expiresAt } = createSession(user.id, input.userAgent, db, now);
  return { ok: true, needsTotp: false, token, expiresAt, next };
}

// Second step: pending cookie + a 6-digit code or recovery code. Failures count against the same lockout
// counters as bad passwords (per IP and per account).
export async function completeTotpLogin(
  input: { pendingToken: string | undefined; code: string; ip: string; userAgent: string | null },
  db: DB = getDb(),
  now = Date.now(),
): Promise<VerifyResult> {
  const pending = getPendingLogin(input.pendingToken, db, now);
  if (!pending) return { ok: false, error: EXPIRED_ERROR };
  const user = db.select().from(schema.users).where(eq(schema.users.id, pending.userId)).get();
  if (!user) return { ok: false, error: EXPIRED_ERROR };
  const ipKey = `ip:${input.ip.slice(0, 64)}`;
  const emailKey = `email:${user.email}`;

  if (isLocked(db, ipKey, emailKey, now)) return { ok: false, error: LOCKED_ERROR };

  if (checkSecondFactor(db, user.id, input.code.slice(0, 40), now) !== "ok") {
    recordFailure(db, ipKey, emailKey, now);
    return { ok: false, error: BAD_CODE_ERROR };
  }

  deletePendingLogin(pending.idHash, db);
  db.delete(schema.loginAttempts).where(inArray(schema.loginAttempts.key, [emailKey])).run();
  const { token, expiresAt } = createSession(user.id, input.userAgent ?? pending.userAgent, db, now);
  return { ok: true, token, expiresAt, next: pending.next };
}
