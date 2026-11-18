import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import { decrypt, encrypt } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";

// RFC 6238: SHA-1, 6 digits, 30 second step. That is what Authy and every other authenticator app expects.
export const PERIOD_S = 30;
export const DIGITS = 6;
export const WINDOW_STEPS = 1; // accept the previous and next step too (clock drift)
export const RECOVERY_CODE_COUNT = 10;
const ISSUER = "ownbank";

export function stepFor(now: number): number {
  return Math.floor(now / 1000 / PERIOD_S);
}

function totpFor(secretBase32: string, label = "owner"): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD_S,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function newSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function otpauthUri(secretBase32: string, email: string): string {
  return totpFor(secretBase32, email).toString();
}

export function codeAt(secretBase32: string, timestampMs: number): string {
  return totpFor(secretBase32).generate({ timestamp: timestampMs });
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Pure check. Returns the matching step (within +-1 of now) that is newer than lastStep, else null.
// Every candidate is compared, so timing does not reveal which step matched.
export function verifyCode(secretBase32: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const totp = totpFor(secretBase32);
  const current = stepFor(now);
  let matched: number | null = null;
  for (let d = -WINDOW_STEPS; d <= WINDOW_STEPS; d++) {
    const step = current + d;
    const expected = totp.generate({ timestamp: step * PERIOD_S * 1000 });
    if (safeEqual(expected, clean) && (lastStep === null || step > lastStep) && matched === null) matched = step;
  }
  return matched;
}

// ---------- recovery codes ----------

// No 0/o/1/l/i so a code read off a screen is hard to mistype.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function normalizeRecovery(code: string): string {
  return code.toLowerCase().replace(/[\s-]+/g, "");
}

export function isRecoveryShape(code: string): boolean {
  return /^[a-z0-9]{8}$/.test(normalizeRecovery(code));
}

export function hashRecovery(code: string): string {
  return createHash("sha256").update(normalizeRecovery(code)).digest("hex");
}

function randomCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

// Replaces every recovery code for the user with a fresh set. Returns the plain codes (shown once, never stored).
export function replaceRecoveryCodes(db: DB, userId: number): string[] {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomCode);
  db.transaction((tx) => {
    tx.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId)).run();
    for (const c of codes) tx.insert(schema.recoveryCodes).values({ userId, codeHash: hashRecovery(c) }).run();
  });
  return codes;
}

export function unusedRecoveryCount(db: DB, userId: number): number {
  return db
    .select()
    .from(schema.recoveryCodes)
    .where(and(eq(schema.recoveryCodes.userId, userId), isNull(schema.recoveryCodes.usedAt)))
    .all().length;
}

// Single use: the UPDATE only matches an unused row, so two racing requests cannot both win.
export function consumeRecoveryCode(db: DB, userId: number, code: string, now = Date.now()): boolean {
  const r = db
    .update(schema.recoveryCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.recoveryCodes.userId, userId),
        eq(schema.recoveryCodes.codeHash, hashRecovery(code)),
        isNull(schema.recoveryCodes.usedAt),
      ),
    )
    .run();
  return r.changes === 1;
}

// ---------- per-user state ----------

export type TotpState = "off" | "pending" | "on";

export function totpState(user: { totpSecretEnc: string | null; totpEnabledAt: number | null }): TotpState {
  if (!user.totpSecretEnc) return "off";
  return user.totpEnabledAt ? "on" : "pending";
}

export function getUser(db: DB, userId: number) {
  return db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
}

// Starts (or restarts) setup: stores a fresh encrypted secret that is not active until confirmed.
export function beginSetup(db: DB, userId: number): string {
  const secret = newSecret();
  db.update(schema.users)
    .set({ totpSecretEnc: encrypt(secret), totpEnabledAt: null, totpLastStep: null })
    .where(eq(schema.users.id, userId))
    .run();
  return secret;
}

export function pendingSecret(db: DB, userId: number): string | null {
  const u = getUser(db, userId);
  if (!u || totpState(u) !== "pending") return null;
  return decrypt(u.totpSecretEnc!);
}

// Confirms setup with a code from the app, turns 2FA on, returns the one-time recovery codes. Null = wrong code.
export function confirmSetup(db: DB, userId: number, code: string, now = Date.now()): string[] | null {
  const secret = pendingSecret(db, userId);
  if (!secret) return null;
  const step = verifyCode(secret, code, null, now);
  if (step === null) return null;
  db.update(schema.users).set({ totpEnabledAt: now, totpLastStep: step }).where(eq(schema.users.id, userId)).run();
  return replaceRecoveryCodes(db, userId);
}

export function disableTotp(db: DB, userId: number) {
  db.transaction((tx) => {
    tx.update(schema.users).set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null }).where(eq(schema.users.id, userId)).run();
    tx.delete(schema.recoveryCodes).where(eq(schema.recoveryCodes.userId, userId)).run();
  });
}

export type CodeCheck = "ok" | "bad";

// Checks a 6-digit code (once per step) or a recovery code for a user with 2FA on.
// The step is recorded with a conditional UPDATE so the same code cannot pass twice, even in parallel.
export function checkSecondFactor(db: DB, userId: number, input: string, now = Date.now()): CodeCheck {
  const u = getUser(db, userId);
  if (!u || totpState(u) !== "on") return "bad";
  const trimmed = input.trim();
  if (/^[\d\s]{6,7}$/.test(trimmed)) {
    const step = verifyCode(decrypt(u.totpSecretEnc!), trimmed, u.totpLastStep, now);
    if (step === null) return "bad";
    const r = db.$client
      .prepare("UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)")
      .run(step, userId, step);
    return r.changes === 1 ? "ok" : "bad";
  }
  if (isRecoveryShape(trimmed)) return consumeRecoveryCode(db, userId, trimmed, now) ? "ok" : "bad";
  return "bad";
}
