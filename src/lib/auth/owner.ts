// Owner account creation, shared by the /setup page and `npm run create-owner`. No "server-only": scripts use it.
import { eq } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { hashPassword, MIN_PASSWORD_LENGTH } from "./password";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ownerExists(db: DB): boolean {
  return db.select({ id: schema.users.id }).from(schema.users).limit(1).get() !== undefined;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase().slice(0, 254);
}

// Returns an error message, or null when the pair is acceptable.
export function checkCredentials(email: string, password: string): string | null {
  if (!EMAIL_RE.test(email)) return "That does not look like an email address.";
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 1000) return "Password is too long.";
  return null;
}

// One owner per install. Throws if one exists already.
export async function createOwner(db: DB, emailRaw: string, password: string, now = Date.now()): Promise<{ id: number; email: string }> {
  const email = normalizeEmail(emailRaw);
  const bad = checkCredentials(email, password);
  if (bad) throw new Error(bad);
  const passwordHash = await hashPassword(password);
  return db.transaction((tx) => {
    if (tx.select({ id: schema.users.id }).from(schema.users).limit(1).get()) throw new Error("An owner already exists.");
    const row = tx.insert(schema.users).values({ email, passwordHash, createdAt: now }).returning({ id: schema.users.id }).get();
    return { id: row.id, email };
  });
}

export function findOwnerByEmail(db: DB, email: string) {
  return db.select().from(schema.users).where(eq(schema.users.email, email)).get();
}
