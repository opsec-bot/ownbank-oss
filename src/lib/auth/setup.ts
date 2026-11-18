// First-run setup. While no owner exists the server holds a one-time setup code (only its hash is stored).
// Whoever can read the server log can create the owner; nobody else can. No "server-only": instrumentation uses it.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { createOwner, normalizeEmail, ownerExists, checkCredentials } from "./owner";
import { createSession } from "./session";

export const SETUP_KEY = "setup_code_hash";
export const SETUP_MAX_FAILED = 5;
export const SETUP_WINDOW_MS = 15 * 60 * 1000;

export const SETUP_LOCKED = "Too many attempts, try again later";
export const SETUP_BAD_CODE = "That setup code is not right";
export const SETUP_DONE = "Setup is already finished";

// No 0/O/1/I/L: easy to read off a log line.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
const hashCode = (c: string) => createHash("sha256").update(normalizeCode(c)).digest("hex");

export function newSetupCode(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}

function storeHash(db: DB, code: string) {
  db.insert(schema.appState)
    .values({ key: SETUP_KEY, value: hashCode(code) })
    .onConflictDoUpdate({ target: schema.appState.key, set: { value: hashCode(code) } })
    .run();
}

// Called at server start. Returns a fresh code when no owner exists yet, null otherwise.
export function prepareSetupCode(db: DB): string | null {
  if (ownerExists(db)) {
    db.delete(schema.appState).where(eq(schema.appState.key, SETUP_KEY)).run();
    return null;
  }
  const code = newSetupCode();
  storeHash(db, code);
  return code;
}

export function setupBanner(code: string, appUrl: string): string {
  const line = `ownbank setup code: ${code}  -  open ${appUrl.replace(/\/$/, "")}/setup`;
  const bar = "=".repeat(line.length + 4);
  return `\n${bar}\n  ${line}\n${bar}\n`;
}

function codeMatches(db: DB, code: string): boolean {
  const row = db.select().from(schema.appState).where(eq(schema.appState.key, SETUP_KEY)).get();
  if (!row) return false;
  const a = Buffer.from(row.value);
  const b = Buffer.from(hashCode(code));
  return a.length === b.length && timingSafeEqual(a, b);
}

function failedCount(db: DB, key: string, now: number): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.loginAttempts)
      .where(and(eq(schema.loginAttempts.key, key), gt(schema.loginAttempts.at, now - SETUP_WINDOW_MS)))
      .get()?.n ?? 0
  );
}

export type SetupInput = { code: string; email: string; password: string; confirm: string; ip: string; userAgent: string | null };
export type SetupResult = { ok: true; token: string; expiresAt: number } | { ok: false; error: string };

export async function completeSetup(input: SetupInput, db: DB, now = Date.now()): Promise<SetupResult> {
  if (ownerExists(db)) return { ok: false, error: SETUP_DONE };
  const key = `setup:${input.ip.slice(0, 64)}`;
  if (failedCount(db, key, now) >= SETUP_MAX_FAILED) return { ok: false, error: SETUP_LOCKED };

  if (!codeMatches(db, input.code.slice(0, 40))) {
    db.insert(schema.loginAttempts).values({ key, at: now }).run();
    db.delete(schema.loginAttempts).where(lt(schema.loginAttempts.at, now - SETUP_WINDOW_MS)).run();
    return { ok: false, error: SETUP_BAD_CODE };
  }

  const email = normalizeEmail(input.email);
  const bad = checkCredentials(email, input.password);
  if (bad) return { ok: false, error: bad };
  if (input.password !== input.confirm) return { ok: false, error: "The passwords do not match." };

  let owner;
  try {
    owner = await createOwner(db, email, input.password, now);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the owner." };
  }
  db.delete(schema.appState).where(eq(schema.appState.key, SETUP_KEY)).run();
  db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.key, key)).run();
  const { token, expiresAt } = createSession(owner.id, input.userAgent, db, now);
  return { ok: true, token, expiresAt };
}
