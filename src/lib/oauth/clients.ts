import { randomBytes } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema, type DB } from "@/lib/db";
import { MAX_CLIENTS } from "./config";

// Redirect URIs a client may register: Claude's two callbacks (exact) and loopback http (any port, any path) for
// the MCP Inspector and local testing. Nothing else, so an approved code can only ever go to one of these.
const EXACT = new Set(["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]);

export function isAllowedRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length === 0 || uri.length > 500) return false;
  if (EXACT.has(uri)) return true;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.protocol !== "http:") return false;
  if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return false;
  if (u.username || u.password || u.hash) return false;
  // Re-serializing must give back what was sent, so no odd encodings or backslashes slip through.
  return uri.startsWith(`http://${u.hostname}`) && !uri.includes("\\");
}

export type RegisterResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string };

const GRANTS = ["authorization_code", "refresh_token"];

function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100);
  return s || null;
}

// A client counts as in use while it has a token that is not revoked and whose refresh half has not expired.
function inUseIds(db: DB, now: number): Set<string> {
  const rows = db.$client
    .prepare("SELECT DISTINCT client_id AS id FROM oauth_tokens WHERE revoked_at IS NULL AND refresh_expires_at > ?")
    .all(now) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

// RFC 7591 dynamic registration for public clients. Keeps at most MAX_CLIENTS rows by deleting the oldest unused ones.
export function registerClient(body: unknown, db: DB = getDb(), now = Date.now()): RegisterResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_client_metadata", description: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 5) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris must be a list of 1 to 5 URIs" };
  }
  for (const u of uris) {
    if (!isAllowedRedirectUri(u)) {
      return {
        ok: false,
        error: "invalid_redirect_uri",
        description: "Only the Claude callback URLs and http://localhost or http://127.0.0.1 are allowed",
      };
    }
  }
  const method = b.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    return { ok: false, error: "invalid_client_metadata", description: "Only token_endpoint_auth_method none is supported" };
  }
  if (b.grant_types !== undefined) {
    if (!Array.isArray(b.grant_types) || b.grant_types.some((g) => typeof g !== "string" || !GRANTS.includes(g))) {
      return { ok: false, error: "invalid_client_metadata", description: "grant_types must be authorization_code and/or refresh_token" };
    }
  }
  if (b.response_types !== undefined) {
    if (!Array.isArray(b.response_types) || b.response_types.some((r) => r !== "code")) {
      return { ok: false, error: "invalid_client_metadata", description: "response_types must be code" };
    }
  }

  const count = (db.$client.prepare("SELECT COUNT(*) AS n FROM oauth_clients").get() as { n: number }).n;
  if (count >= MAX_CLIENTS) {
    const busy = inUseIds(db, now);
    const oldestFirst = db.select().from(schema.oauthClients).orderBy(asc(schema.oauthClients.createdAt)).all();
    let toDelete = count - MAX_CLIENTS + 1;
    for (const c of oldestFirst) {
      if (toDelete <= 0) break;
      if (busy.has(c.clientId)) continue;
      db.delete(schema.oauthClients).where(eq(schema.oauthClients.clientId, c.clientId)).run();
      toDelete--;
    }
    if (toDelete > 0) return { ok: false, error: "invalid_client_metadata", description: "Too many registered clients" };
  }

  const clientId = `ob_${randomBytes(16).toString("base64url")}`;
  const redirectUris = uris as string[];
  const name = cleanName(b.client_name);
  db.insert(schema.oauthClients).values({ clientId, clientName: name, redirectUris: JSON.stringify(redirectUris), createdAt: now }).run();
  return {
    ok: true,
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor(now / 1000),
      ...(name ? { client_name: name } : {}),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: GRANTS,
      response_types: ["code"],
    },
  };
}

export type OAuthClient = { clientId: string; clientName: string | null; redirectUris: string[] };

export function getClient(db: DB, clientId: string | undefined | null): OAuthClient | null {
  if (!clientId || clientId.length > 100) return null;
  const row = db.select().from(schema.oauthClients).where(eq(schema.oauthClients.clientId, clientId)).get();
  if (!row) return null;
  let uris: string[] = [];
  try {
    const parsed = JSON.parse(row.redirectUris);
    if (Array.isArray(parsed)) uris = parsed.filter((u): u is string => typeof u === "string");
  } catch {
    // treat a corrupt row as having no redirect URIs
  }
  return { clientId: row.clientId, clientName: row.clientName, redirectUris: uris };
}

export function clientCount(db: DB): number {
  return db.select({ n: sql<number>`count(*)` }).from(schema.oauthClients).get()?.n ?? 0;
}
