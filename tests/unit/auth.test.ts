import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { attemptLogin, GENERIC_ERROR, LOCKED_ERROR, MAX_FAILED, WINDOW_MS } from "@/lib/auth/login";
import { hashPassword, verifyDummy, verifyPassword } from "@/lib/auth/password";
import { SESSION_TTL_MS } from "@/lib/auth/cookie";
import { createSession, deleteSession, hashToken, validateSession } from "@/lib/auth/session";
import { openDb, schema, type DB } from "@/lib/db";

const PASSWORD = "correct horse battery";
let db: DB;
let userId: number;

beforeEach(async () => {
  db = openDb(":memory:");
  const row = db
    .insert(schema.users)
    .values({ email: "owner@example.com", passwordHash: await hashPassword(PASSWORD), createdAt: 1 })
    .returning({ id: schema.users.id })
    .get();
  userId = row.id;
});

describe("password hashing", () => {
  it("uses argon2id and verifies", async () => {
    const h = await hashPassword(PASSWORD);
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, PASSWORD)).toBe(true);
    expect(await verifyPassword(h, "wrong password!!")).toBe(false);
    expect(await verifyPassword("not a hash", PASSWORD)).toBe(false);
  });

  it("dummy verify always returns false", async () => {
    expect(await verifyDummy(PASSWORD)).toBe(false);
  });
});

describe("sessions", () => {
  it("stores only the hash, validates, and returns the user", () => {
    const { token } = createSession(userId, "ua", db);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = db.select().from(schema.sessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].idHash).toBe(hashToken(token));
    expect(rows[0].idHash).not.toBe(token);
    expect(validateSession(token, db)).toEqual({ id: userId, email: "owner@example.com" });
  });

  it("rejects unknown and missing tokens", () => {
    expect(validateSession("nope", db)).toBeNull();
    expect(validateSession(undefined, db)).toBeNull();
  });

  it("expires after 30 days without use and deletes the row", () => {
    const now = 1_000_000;
    const { token } = createSession(userId, null, db, now);
    expect(validateSession(token, db, now + SESSION_TTL_MS + 1)).toBeNull();
    expect(db.select().from(schema.sessions).all()).toHaveLength(0);
  });

  it("slides expiry only when older than a day", () => {
    const now = 1_000_000;
    const { token } = createSession(userId, null, db, now);
    const expiry = () => db.select().from(schema.sessions).get()!.expiresAt;
    validateSession(token, db, now + 60_000);
    expect(expiry()).toBe(now + SESSION_TTL_MS);
    const later = now + 2 * 24 * 60 * 60 * 1000;
    validateSession(token, db, later);
    expect(expiry()).toBe(later + SESSION_TTL_MS);
  });

  it("logout deletes the row", () => {
    const { token } = createSession(userId, null, db);
    deleteSession(token, db);
    expect(validateSession(token, db)).toBeNull();
  });
});

describe("login and lockout", () => {
  const base = { ip: "1.2.3.4", userAgent: "test" };

  it("logs in with the right password and issues a valid session", async () => {
    const r = await attemptLogin({ ...base, email: "Owner@Example.com", password: PASSWORD }, db);
    expect(r.ok).toBe(true);
    if (r.ok && !r.needsTotp) expect(validateSession(r.token, db)?.email).toBe("owner@example.com");
  });

  it("locks after 5 failures, even for the right password", async () => {
    for (let i = 0; i < MAX_FAILED; i++) {
      const r = await attemptLogin({ ...base, email: "owner@example.com", password: "wrong wrong wrong" }, db);
      expect(r).toEqual({ ok: false, error: GENERIC_ERROR });
    }
    const locked = await attemptLogin({ ...base, email: "owner@example.com", password: PASSWORD }, db);
    expect(locked).toEqual({ ok: false, error: LOCKED_ERROR });
  });

  it("locks per email across different IPs", async () => {
    for (let i = 0; i < MAX_FAILED; i++) {
      await attemptLogin({ ip: `9.9.9.${i}`, userAgent: null, email: "owner@example.com", password: "nope nope nope" }, db);
    }
    const r = await attemptLogin({ ip: "8.8.8.8", userAgent: null, email: "owner@example.com", password: PASSWORD }, db);
    expect(r).toEqual({ ok: false, error: LOCKED_ERROR });
  });

  it("locks per IP across different emails", async () => {
    for (let i = 0; i < MAX_FAILED; i++) {
      await attemptLogin({ ...base, email: `x${i}@example.com`, password: "nope nope nope" }, db);
    }
    const r = await attemptLogin({ ...base, email: "owner@example.com", password: PASSWORD }, db);
    expect(r).toEqual({ ok: false, error: LOCKED_ERROR });
  });

  it("lockout ends after the 15 minute window", async () => {
    const now = 5_000_000;
    for (let i = 0; i < MAX_FAILED; i++) {
      await attemptLogin({ ...base, email: "owner@example.com", password: "nope nope nope" }, db, now);
    }
    const r = await attemptLogin({ ...base, email: "owner@example.com", password: PASSWORD }, db, now + WINDOW_MS + 1);
    expect(r.ok).toBe(true);
  });

  it("unknown email takes the dummy-verify path with the same generic error", async () => {
    const r = await attemptLogin({ ...base, email: "nobody@example.com", password: PASSWORD }, db);
    expect(r).toEqual({ ok: false, error: GENERIC_ERROR });
    const attempts = db.select().from(schema.loginAttempts).where(eq(schema.loginAttempts.key, "email:nobody@example.com")).all();
    expect(attempts).toHaveLength(1);
  });
});

describe("db setup", () => {
  it("seeds categories and the settings row", () => {
    expect(db.select().from(schema.categories).all()).toHaveLength(19);
    expect(db.select().from(schema.settings).get()?.id).toBe(1);
  });
});
