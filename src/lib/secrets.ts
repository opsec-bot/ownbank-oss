// First-boot secrets. Anything missing from the environment is read from <db dir>/secrets.json, and generated into
// that file once if it is not there yet. Environment values always win, so a deploy that sets every secret itself
// never touches the file. Values are never logged. No "server-only": instrumentation.ts and scripts load this.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { generateVAPIDKeys } from "web-push";

export type SecretName = "TOKEN_ENC_KEY" | "SYNC_SECRET" | "MCP_TOKEN" | "VAPID";
export type SecretSource = "env" | "file" | "generated";
export type SecretsReport = { sources: Record<SecretName, SecretSource>; file: string | null };

type Stored = { TOKEN_ENC_KEY?: string; SYNC_SECRET?: string; MCP_TOKEN?: string; VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string };

const set = (v: string | undefined): v is string => typeof v === "string" && v.trim() !== "";

export function secretsFilePath(databasePath: string | undefined = process.env.DATABASE_PATH): string | null {
  const p = set(databasePath) ? databasePath : "./data/ownbank.db";
  if (p === ":memory:") return null;
  return path.join(path.dirname(path.resolve(p)), "secrets.json");
}

function readFile(file: string | null): Stored {
  if (!file || !fs.existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Stored) : {};
  } catch {
    // A corrupt file must not be silently replaced: that would orphan every encrypted bank token.
    throw new Error(`${file} exists but is not valid JSON. Fix or remove it, then restart.`);
  }
}

function writeFile(file: string, data: Stored) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

const token = (bytes: number) => randomBytes(bytes).toString("base64url");

// Fills process.env for every secret that is missing. Safe to call more than once.
export function ensureSecrets(env: Record<string, string | undefined> = process.env): SecretsReport {
  const file = secretsFilePath(env.DATABASE_PATH);
  const stored = readFile(file);
  const next: Stored = { ...stored };
  let dirty = false;
  const sources = {} as Record<SecretName, SecretSource>;

  const simple = (name: "TOKEN_ENC_KEY" | "SYNC_SECRET" | "MCP_TOKEN", make: () => string) => {
    if (set(env[name])) {
      sources[name] = "env";
      return;
    }
    if (set(stored[name])) {
      sources[name] = "file";
    } else {
      next[name] = make();
      dirty = true;
      sources[name] = "generated";
    }
    env[name] = next[name];
  };
  simple("TOKEN_ENC_KEY", () => randomBytes(32).toString("base64"));
  simple("SYNC_SECRET", () => token(32));
  simple("MCP_TOKEN", () => token(32));

  if (set(env.VAPID_PUBLIC_KEY) && set(env.VAPID_PRIVATE_KEY)) {
    sources.VAPID = "env";
  } else {
    if (set(stored.VAPID_PUBLIC_KEY) && set(stored.VAPID_PRIVATE_KEY)) {
      sources.VAPID = "file";
    } else {
      const k = generateVAPIDKeys();
      next.VAPID_PUBLIC_KEY = k.publicKey;
      next.VAPID_PRIVATE_KEY = k.privateKey;
      dirty = true;
      sources.VAPID = "generated";
    }
    env.VAPID_PUBLIC_KEY = next.VAPID_PUBLIC_KEY;
    env.VAPID_PRIVATE_KEY = next.VAPID_PRIVATE_KEY;
  }
  if (!set(env.VAPID_SUBJECT)) env.VAPID_SUBJECT = "mailto:admin@localhost";

  if (dirty && file) writeFile(file, next);
  return { sources, file };
}

// Read-only view for `npm run doctor`: where each secret would come from, without generating or exporting anything.
export function inspectSecrets(env: Record<string, string | undefined> = process.env): Record<SecretName, "env" | "file" | "missing"> {
  const stored = readFile(secretsFilePath(env.DATABASE_PATH));
  const pick = (name: "TOKEN_ENC_KEY" | "SYNC_SECRET" | "MCP_TOKEN") => (set(env[name]) ? "env" : set(stored[name]) ? "file" : "missing");
  const vapid =
    set(env.VAPID_PUBLIC_KEY) && set(env.VAPID_PRIVATE_KEY)
      ? "env"
      : set(stored.VAPID_PUBLIC_KEY) && set(stored.VAPID_PRIVATE_KEY)
        ? "file"
        : "missing";
  return { TOKEN_ENC_KEY: pick("TOKEN_ENC_KEY"), SYNC_SECRET: pick("SYNC_SECRET"), MCP_TOKEN: pick("MCP_TOKEN"), VAPID: vapid };
}
