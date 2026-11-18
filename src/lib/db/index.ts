// No "server-only" here: scripts (create-owner, db:migrate) and instrumentation.ts load this outside Next.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export const migrationsFolder = path.join(process.cwd(), "src", "lib", "db", "migrations");

export function dbPath(): string {
  return process.env.DATABASE_PATH || "./data/ownbank.db";
}

export function openDb(file: string, opts: { migrate?: boolean } = {}): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  if (opts.migrate !== false) migrate(db, { migrationsFolder });
  return db;
}

// One connection per server process. Kept on globalThis so dev hot reload does not open a new one on each edit.
const g = globalThis as unknown as { __ownbankDb?: DB };

export function getDb(): DB {
  if (!g.__ownbankDb) g.__ownbankDb = openDb(dbPath());
  return g.__ownbankDb;
}

export function setDbForTests(db: DB | undefined) {
  g.__ownbankDb = db;
}

export { schema };
