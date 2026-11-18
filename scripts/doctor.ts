// Usage: npm run doctor            (checklist for humans)
//        npm run doctor -- --json  (machine-readable, for AI agents)
// Exit code 0 when every required check passes, 1 otherwise. Never prints secret values. Read-only: it does not
// change the database or generate secrets. Run it from the app directory (inside Docker: docker compose exec ownbank npm run doctor).
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { inspectSecrets, secretsFilePath } from "../src/lib/secrets";
import { isValidTimezone, resolveTimezone, zoneLabel } from "../src/lib/timezone";

type Level = "pass" | "fail" | "warn" | "info";
type Check = { id: string; level: Level; label: string; detail: string };

const checks: Check[] = [];
const add = (id: string, level: Level, label: string, detail: string) => checks.push({ id, level, label, detail });
const asJson = process.argv.includes("--json");
const env = process.env;
const on = (v: string | undefined) => typeof v === "string" && v.trim() !== "";

function timeAgo(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function main() {
  const dbFile = on(env.DATABASE_PATH) ? env.DATABASE_PATH! : "./data/ownbank.db";
  let db: Database.Database | null = null;

  // Database and migrations.
  if (!fs.existsSync(dbFile)) {
    add("database", "fail", "Database", `${dbFile} does not exist yet. Start the server once so it creates the database.`);
  } else {
    try {
      db = new Database(dbFile, { readonly: true, fileMustExist: true });
      db.prepare("SELECT 1").get();
      const journal = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src", "lib", "db", "migrations", "meta", "_journal.json"), "utf8")) as { entries: unknown[] };
      const applied = (db.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as { n: number }).n;
      if (applied >= journal.entries.length) add("database", "pass", "Database", `${dbFile} opens, ${applied} migrations applied`);
      else add("database", "fail", "Database", `${applied} of ${journal.entries.length} migrations applied. Restart the server to apply the rest.`);
    } catch (e) {
      add("database", "fail", "Database", `cannot read ${dbFile}: ${e instanceof Error ? e.message : "unknown error"}`);
      db = null;
    }
  }

  // Owner.
  if (db) {
    try {
      const n = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
      if (n > 0) add("owner", "pass", "Owner account", "exists");
      else add("owner", "fail", "Owner account", "none yet. Open <APP_URL>/setup with the setup code from the server log, or run npm run create-owner.");
    } catch {
      add("owner", "fail", "Owner account", "users table missing");
    }
  } else add("owner", "fail", "Owner account", "database not available");

  // Secrets.
  const s = inspectSecrets(env);
  const file = secretsFilePath(dbFile);
  const secretNames: [keyof typeof s, string][] = [
    ["TOKEN_ENC_KEY", "Encryption key"],
    ["SYNC_SECRET", "Sync secret"],
    ["MCP_TOKEN", "MCP token"],
    ["VAPID", "Push (VAPID) keys"],
  ];
  for (const [k, label] of secretNames) {
    if (s[k] === "missing") {
      // They are generated on the next server start, so this is only a hard failure for the encryption key once a bank is connected.
      add(`secret_${k}`, k === "TOKEN_ENC_KEY" ? "warn" : "info", label, `not set yet. Generated on first server start${file ? ` into ${file}` : ""}.`);
    } else add(`secret_${k}`, "pass", label, `present (from ${s[k] === "env" ? "environment" : "secrets.json"})`);
  }

  // URL and timezone.
  const prod = env.NODE_ENV === "production";
  const appUrl = on(env.APP_URL) ? env.APP_URL! : "";
  if (!appUrl) add("app_url", prod ? "warn" : "info", "APP_URL", "not set, defaults to http://localhost:3000");
  else {
    let host = "";
    try {
      host = new URL(appUrl).hostname;
    } catch {
      /* handled below */
    }
    if (!host) add("app_url", "fail", "APP_URL", "not a valid URL");
    else if (prod && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) add("app_url", "warn", "APP_URL", `${appUrl} is localhost. Set it to the public address (needed for OAuth and push links).`);
    else add("app_url", "pass", "APP_URL", appUrl);
  }
  const tzRaw = on(env.APP_TIMEZONE) ? env.APP_TIMEZONE!.trim() : "";
  if (tzRaw && !isValidTimezone(tzRaw)) add("timezone", "fail", "Timezone", `APP_TIMEZONE "${tzRaw}" is not a valid IANA name`);
  else {
    const tz = resolveTimezone(tzRaw || undefined);
    add("timezone", "pass", "Timezone", `${tz} (${zoneLabel(tz)})${tzRaw ? "" : ", default"}`);
  }

  // Bank.
  if (db) {
    try {
      const c = db.prepare("SELECT institution_name AS name, status, last_synced_at AS at, last_error AS err FROM connections ORDER BY id LIMIT 1").get() as
        | { name: string; status: string; at: number | null; err: string | null }
        | undefined;
      if (!c) add("bank", "warn", "Bank", "not connected. Open Settings > Bank and paste a SimpleFIN setup token.");
      else if (c.status === "broken") add("bank", "fail", "Bank", `connection broken${c.err ? `: ${c.err}` : ""}. Replace it in Settings > Bank.`);
      else add("bank", c.at ? "pass" : "warn", "Bank", c.at ? `${c.name}, active, last synced ${timeAgo(c.at)}` : `${c.name}, active, never synced yet`);
    } catch {
      add("bank", "warn", "Bank", "connections table missing");
    }
  }

  // Optional features.
  const feat = (id: string, label: string, enabled: boolean, how: string) => add(`feature_${id}`, "info", label, enabled ? "on" : `off. ${how}`);
  feat("wallets", "Crypto wallets (Helius)", on(env.HELIUS_RPC_URL), "Set HELIUS_RPC_URL (free key at dashboard.helius.dev).");
  feat("push", "Web push (VAPID)", s.VAPID !== "missing", "Generated on first server start.");
  feat("ntfy", "ntfy notifications", on(env.NTFY_TOPIC), "Set NTFY_TOPIC.");
  feat("backups", "Litestream backups", on(env.BUCKET_NAME), "Set BUCKET_NAME and the AWS_* variables.");
  feat("mcp", "MCP token", s.MCP_TOKEN !== "missing", "Generated on first server start.");
  feat("mcp_write", "MCP write tools", env.MCP_WRITE_ENABLED === "true" || env.MCP_WRITE_ENABLED === "1", "Off by default. Set MCP_WRITE_ENABLED=true to allow.");

  db?.close();

  const failed = checks.filter((c) => c.level === "fail");
  const ok = failed.length === 0;
  if (asJson) {
    const byId = (id: string) => checks.find((c) => c.id === id);
    console.log(
      JSON.stringify(
        {
          ok,
          database: byId("database")?.level === "pass",
          owner: byId("owner")?.level === "pass",
          bankConnected: byId("bank")?.level === "pass",
          checks,
        },
        null,
        2,
      ),
    );
  } else {
    const mark: Record<Level, string> = { pass: "[ok]  ", fail: "[FAIL]", warn: "[warn]", info: "[info]" };
    for (const c of checks) console.log(`${mark[c.level]} ${c.label}: ${c.detail}`);
    console.log("");
    console.log(ok ? "All required checks passed." : `${failed.length} check(s) failed.`);
  }
  process.exit(ok ? 0 : 1);
}

main();
