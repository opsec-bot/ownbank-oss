import { beforeEach, describe, expect, it } from "vitest";
import { ownerExists } from "@/lib/auth/owner";
import { completeSetup, prepareSetupCode, SETUP_BAD_CODE, SETUP_DONE, SETUP_LOCKED, SETUP_MAX_FAILED } from "@/lib/auth/setup";
import { validateSession } from "@/lib/auth/session";
import { openDb, type DB } from "@/lib/db";

const PASSWORD = "a long enough password";
let db: DB;
let code: string;

const input = (over: Partial<Parameters<typeof completeSetup>[0]> = {}) => ({
  code,
  email: "Owner@Example.com",
  password: PASSWORD,
  confirm: PASSWORD,
  ip: "1.2.3.4",
  userAgent: "test",
  ...over,
});

beforeEach(() => {
  db = openDb(":memory:");
  code = prepareSetupCode(db)!;
});

describe("first-run setup", () => {
  it("makes a code of three groups of four", () => {
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(ownerExists(db)).toBe(false);
  });

  it("rejects a wrong code and creates nothing", async () => {
    const r = await completeSetup(input({ code: "AAAA-BBBB-CCCC" }), db);
    expect(r).toEqual({ ok: false, error: SETUP_BAD_CODE });
    expect(ownerExists(db)).toBe(false);
  });

  it("locks after repeated wrong codes, even for the right code", async () => {
    for (let i = 0; i < SETUP_MAX_FAILED; i++) await completeSetup(input({ code: "AAAA-BBBB-CCCC" }), db);
    expect(await completeSetup(input(), db)).toEqual({ ok: false, error: SETUP_LOCKED });
  });

  it("checks passwords", async () => {
    expect((await completeSetup(input({ confirm: "different password!" }), db)).ok).toBe(false);
    expect((await completeSetup(input({ password: "short", confirm: "short" }), db)).ok).toBe(false);
    expect(ownerExists(db)).toBe(false);
  });

  it("works once, logs in, and accepts the code lowercase", async () => {
    const r = await completeSetup(input({ code: code.toLowerCase() }), db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(validateSession(r.token, db)?.email).toBe("owner@example.com");
    expect(ownerExists(db)).toBe(true);
    // Locked after an owner exists.
    expect(await completeSetup(input({ email: "other@example.com" }), db)).toEqual({ ok: false, error: SETUP_DONE });
  });

  it("prints no code once an owner exists", async () => {
    await completeSetup(input(), db);
    expect(prepareSetupCode(db)).toBeNull();
  });
});
