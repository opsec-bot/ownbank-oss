import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { attemptLogin, BAD_CODE_ERROR, completeTotpLogin, EXPIRED_ERROR, LOCKED_ERROR, MAX_FAILED } from "@/lib/auth/login";
import { hashPassword } from "@/lib/auth/password";
import { createPendingLogin, getPendingLogin, PENDING_TTL_MS, safeNext } from "@/lib/auth/pending";
import { validateSession } from "@/lib/auth/session";
import {
  beginSetup,
  checkSecondFactor,
  codeAt,
  confirmSetup,
  consumeRecoveryCode,
  disableTotp,
  getUser,
  hashRecovery,
  newSecret,
  RECOVERY_CODE_COUNT,
  replaceRecoveryCodes,
  stepFor,
  totpState,
  unusedRecoveryCount,
  verifyCode,
} from "@/lib/auth/totp";
import { openDb, schema, type DB } from "@/lib/db";

const PASSWORD = "correct horse battery";
const NOW = 1_800_000_000_000; // fixed clock, ms
let db: DB;
let userId: number;

beforeEach(async () => {
  db = openDb(":memory:");
  userId = db
    .insert(schema.users)
    .values({ email: "owner@example.com", passwordHash: await hashPassword(PASSWORD), createdAt: 1 })
    .returning({ id: schema.users.id })
    .get().id;
});

// Turns 2FA on and returns the secret. The confirming code uses up step(NOW).
function enable(): string {
  const secret = beginSetup(db, userId);
  expect(confirmSetup(db, userId, codeAt(secret, NOW), NOW)).not.toBeNull();
  return secret;
}

async function pending(base: { ip: string; userAgent: string; email: string; password: string }, now = NOW) {
  const r = await attemptLogin(base, db, now);
  if (!r.ok || !r.needsTotp) throw new Error("expected a pending login");
  return r;
}

describe("totp codes", () => {
  it("matches the RFC 6238 SHA-1 test vectors (6 digits, 30 s)", () => {
    // Appendix B secret "12345678901234567890". 8-digit 94287082 at T=59 -> 6-digit 287082.
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(codeAt(secret, 59_000)).toBe("287082");
    expect(codeAt(secret, 1_111_111_109_000)).toBe("081804");
  });

  it("accepts the current step and one step either side", () => {
    const s = newSecret();
    expect(verifyCode(s, codeAt(s, NOW), null, NOW)).toBe(stepFor(NOW));
    expect(verifyCode(s, codeAt(s, NOW - 30_000), null, NOW)).toBe(stepFor(NOW) - 1);
    expect(verifyCode(s, codeAt(s, NOW + 30_000), null, NOW)).toBe(stepFor(NOW) + 1);
  });

  it("rejects codes two steps away, wrong codes and junk", () => {
    const s = newSecret();
    expect(verifyCode(s, codeAt(s, NOW - 60_000), null, NOW)).toBeNull();
    expect(verifyCode(s, codeAt(s, NOW + 60_000), null, NOW)).toBeNull();
    expect(verifyCode(s, "12345", null, NOW)).toBeNull();
    expect(verifyCode(s, "abcdef", null, NOW)).toBeNull();
  });

  it("rejects a step that was already used (replay)", () => {
    const s = newSecret();
    const step = verifyCode(s, codeAt(s, NOW), null, NOW)!;
    expect(verifyCode(s, codeAt(s, NOW), step, NOW)).toBeNull();
    expect(verifyCode(s, codeAt(s, NOW - 30_000), step, NOW)).toBeNull();
    expect(verifyCode(s, codeAt(s, NOW + 30_000), step, NOW)).toBe(step + 1);
  });

  it("stores the secret encrypted and only turns on after a right code", () => {
    const secret = beginSetup(db, userId);
    const row = getUser(db, userId)!;
    expect(row.totpSecretEnc).toMatch(/^v1:/);
    expect(row.totpSecretEnc).not.toContain(secret);
    expect(totpState(row)).toBe("pending");
    const right = codeAt(secret, NOW);
    expect(confirmSetup(db, userId, right === "000000" ? "111111" : "000000", NOW)).toBeNull();
    expect(totpState(getUser(db, userId)!)).toBe("pending");
    const codes = confirmSetup(db, userId, right, NOW)!;
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(totpState(getUser(db, userId)!)).toBe("on");
  });
});

describe("recovery codes", () => {
  it("are xxxx-xxxx, stored as SHA-256, and work once", () => {
    const codes = replaceRecoveryCodes(db, userId);
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    const rows = db.select().from(schema.recoveryCodes).all();
    expect(rows.map((r) => r.codeHash).sort()).toEqual(codes.map(hashRecovery).sort());
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.codeHash))).toBe(true);
    expect(consumeRecoveryCode(db, userId, codes[0])).toBe(true);
    expect(consumeRecoveryCode(db, userId, codes[0])).toBe(false);
    expect(consumeRecoveryCode(db, userId, codes[1].toUpperCase().replace("-", " "))).toBe(true); // forgiving input
    expect(unusedRecoveryCount(db, userId)).toBe(8);
  });

  it("regenerating invalidates the old set", () => {
    const old = replaceRecoveryCodes(db, userId);
    replaceRecoveryCodes(db, userId);
    expect(consumeRecoveryCode(db, userId, old[0])).toBe(false);
  });

  it("disabling 2FA wipes the secret and the codes", () => {
    enable();
    disableTotp(db, userId);
    const row = getUser(db, userId)!;
    expect(totpState(row)).toBe("off");
    expect(row.totpLastStep).toBeNull();
    expect(unusedRecoveryCount(db, userId)).toBe(0);
  });
});

describe("checkSecondFactor", () => {
  it("accepts a code once, then refuses the same code again", () => {
    const secret = enable(); // step(NOW) already used by the confirmation
    expect(checkSecondFactor(db, userId, codeAt(secret, NOW), NOW)).toBe("bad");
    expect(checkSecondFactor(db, userId, codeAt(secret, NOW + 30_000), NOW)).toBe("ok");
    expect(checkSecondFactor(db, userId, codeAt(secret, NOW + 30_000), NOW)).toBe("bad");
  });

  it("is always bad when 2FA is off", () => {
    expect(checkSecondFactor(db, userId, "123456", NOW)).toBe("bad");
  });
});

describe("login with 2FA", () => {
  const base = { ip: "1.2.3.4", userAgent: "test", email: "owner@example.com", password: PASSWORD };

  it("returns a pending login instead of a session", async () => {
    enable();
    const r = await attemptLogin({ ...base, next: "/oauth/authorize?x=1" }, db, NOW);
    expect(r.ok && r.needsTotp).toBe(true);
    if (!r.ok || !r.needsTotp) return;
    expect(db.select().from(schema.sessions).all()).toHaveLength(0);
    const row = db.select().from(schema.pendingLogins).get()!;
    expect(row.idHash).not.toBe(r.pendingToken); // only the hash is stored
    expect(row.userId).toBe(userId);
    expect(row.next).toBe("/oauth/authorize?x=1");
    expect(row.expiresAt).toBe(NOW + PENDING_TTL_MS);
  });

  it("completes with a right code, signs in, and keeps next", async () => {
    const secret = enable();
    const r = await attemptLogin({ ...base, next: "/oauth/authorize?x=1" }, db, NOW);
    if (!r.ok || !r.needsTotp) throw new Error("expected pending");
    const done = await completeTotpLogin(
      { pendingToken: r.pendingToken, code: codeAt(secret, NOW + 30_000), ip: base.ip, userAgent: "test" },
      db,
      NOW + 1000,
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.next).toBe("/oauth/authorize?x=1");
    expect(validateSession(done.token, db)?.email).toBe("owner@example.com");
    expect(db.select().from(schema.pendingLogins).all()).toHaveLength(0);
  });

  it("works with a recovery code, once", async () => {
    enable();
    const codes = replaceRecoveryCodes(db, userId);
    const r = await pending(base);
    const ok = await completeTotpLogin({ pendingToken: r.pendingToken, code: codes[0], ip: base.ip, userAgent: null }, db, NOW);
    expect(ok.ok).toBe(true);
    const r2 = await pending(base);
    const again = await completeTotpLogin({ pendingToken: r2.pendingToken, code: codes[0], ip: base.ip, userAgent: null }, db, NOW);
    expect(again).toEqual({ ok: false, error: BAD_CODE_ERROR });
  });

  it("refuses a replayed code from the same step", async () => {
    const secret = enable();
    const code = codeAt(secret, NOW + 30_000);
    const r = await pending(base);
    expect((await completeTotpLogin({ pendingToken: r.pendingToken, code, ip: base.ip, userAgent: null }, db, NOW)).ok).toBe(true);
    const r2 = await pending(base);
    const replay = await completeTotpLogin({ pendingToken: r2.pendingToken, code, ip: base.ip, userAgent: null }, db, NOW);
    expect(replay).toEqual({ ok: false, error: BAD_CODE_ERROR });
  });

  it("pending login expires after 5 minutes", async () => {
    const secret = enable();
    const r = await pending(base);
    const late = NOW + PENDING_TTL_MS + 1;
    expect(getPendingLogin(r.pendingToken, db, late)).toBeNull();
    const done = await completeTotpLogin({ pendingToken: r.pendingToken, code: codeAt(secret, late), ip: base.ip, userAgent: null }, db, late);
    expect(done).toEqual({ ok: false, error: EXPIRED_ERROR });
    expect(db.select().from(schema.pendingLogins).all()).toHaveLength(0);
  });

  it("rejects missing, unknown and malformed pending tokens", async () => {
    enable();
    for (const t of [undefined, "", "nope", "x".repeat(500)]) {
      expect(await completeTotpLogin({ pendingToken: t, code: "123456", ip: "1.1.1.1", userAgent: null }, db, NOW)).toEqual({
        ok: false,
        error: EXPIRED_ERROR,
      });
    }
  });

  it("locks after 5 bad codes per IP and per account, even with a right code", async () => {
    const secret = enable();
    const r = await pending(base);
    const right = codeAt(secret, NOW + 30_000);
    const wrong = right === "000000" ? "000001" : "000000";
    for (let i = 0; i < MAX_FAILED; i++) {
      const bad = await completeTotpLogin({ pendingToken: r.pendingToken, code: wrong, ip: base.ip, userAgent: null }, db, NOW);
      expect(bad).toEqual({ ok: false, error: BAD_CODE_ERROR });
    }
    const locked = await completeTotpLogin({ pendingToken: r.pendingToken, code: right, ip: base.ip, userAgent: null }, db, NOW);
    expect(locked).toEqual({ ok: false, error: LOCKED_ERROR });
    // The password step is locked too, from another IP (account counter).
    expect(await attemptLogin({ ...base, ip: "9.9.9.9" }, db, NOW)).toEqual({ ok: false, error: LOCKED_ERROR });
  });

  it("re-entering the password does not reset the code lockout", async () => {
    enable();
    for (let i = 0; i < MAX_FAILED - 1; i++) {
      const r = await pending(base);
      await completeTotpLogin({ pendingToken: r.pendingToken, code: "000000", ip: base.ip, userAgent: null }, db, NOW);
    }
    const count = db.select().from(schema.loginAttempts).where(eq(schema.loginAttempts.key, "email:owner@example.com")).all().length;
    expect(count).toBe(MAX_FAILED - 1);
  });

  it("a user without 2FA still gets a session straight away", async () => {
    const r = await attemptLogin(base, db, NOW);
    expect(r.ok && !r.needsTotp).toBe(true);
  });
});

describe("safeNext and pending rows", () => {
  it("only allows same-site paths", () => {
    expect(safeNext("/oauth/authorize?a=1&b=2")).toBe("/oauth/authorize?a=1&b=2");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:1", "", "/login", "/login/verify", undefined, 5]) {
      expect(safeNext(bad)).toBeNull();
    }
  });

  it("createPendingLogin stores a hash and clears expired rows", () => {
    createPendingLogin(userId, null, null, db, NOW);
    createPendingLogin(userId, null, null, db, NOW + PENDING_TTL_MS + 10);
    expect(db.select().from(schema.pendingLogins).all()).toHaveLength(1);
  });
});
