import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { s256, sha256Hex } from "./authorize";
import { ACCESS_TTL_MS, isScope, REFRESH_TTL_MS, resourceUrl, SCOPE_READ, type Scope } from "./config";

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export type TokenFailure = { ok: false; status: number; error: string; description: string };
export type TokenResult = { ok: true; body: TokenResponse } | TokenFailure;

const bad = (error: string, description: string, status = 400): TokenFailure => ({ ok: false, status, error, description });

function newPair(db: DB, clientId: string, scope: string, now: number): TokenResponse {
  const access = randomBytes(32).toString("base64url");
  const refresh = randomBytes(32).toString("base64url");
  db.insert(schema.oauthTokens)
    .values({
      clientId,
      accessHash: sha256Hex(access),
      refreshHash: sha256Hex(refresh),
      accessExpiresAt: now + ACCESS_TTL_MS,
      refreshExpiresAt: now + REFRESH_TTL_MS,
      scope,
      createdAt: now,
    })
    .run();
  // Old dead rows (refresh half expired a week ago) are not worth keeping.
  db.delete(schema.oauthTokens).where(lt(schema.oauthTokens.refreshExpiresAt, now - 7 * 24 * 60 * 60 * 1000)).run();
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope };
}

export function revokeClientTokens(db: DB, clientId: string, now = Date.now()): number {
  return db
    .update(schema.oauthTokens)
    .set({ revokedAt: now })
    .where(and(eq(schema.oauthTokens.clientId, clientId), isNull(schema.oauthTokens.revokedAt)))
    .run().changes;
}

function pkceOk(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(s256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sameResource(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

type Form = Record<string, string | undefined>;

export function exchangeCode(db: DB, f: Form, now = Date.now()): TokenResult {
  const { client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier, resource } = f;
  if (!clientId || !code || !redirectUri || !verifier) {
    return bad("invalid_request", "client_id, code, redirect_uri and code_verifier are required");
  }
  const client = db.select().from(schema.oauthClients).where(eq(schema.oauthClients.clientId, clientId)).get();
  if (!client) return bad("invalid_client", "Unknown client", 401);

  const codeHash = sha256Hex(code);
  const row = db.select().from(schema.oauthCodes).where(eq(schema.oauthCodes.codeHash, codeHash)).get();
  if (!row) return bad("invalid_grant", "Unknown or expired code");

  // Burn the code first. The UPDATE only matches an unused row, so two parallel requests cannot both win.
  const burned = db
    .update(schema.oauthCodes)
    .set({ usedAt: now })
    .where(and(eq(schema.oauthCodes.codeHash, codeHash), isNull(schema.oauthCodes.usedAt)))
    .run().changes;
  if (burned !== 1) {
    // A used code coming back means someone copied it: kill anything it produced.
    if (row.clientId === clientId) revokeClientTokens(db, clientId, now);
    return bad("invalid_grant", "Code was already used");
  }
  if (row.expiresAt <= now) return bad("invalid_grant", "Code expired");
  if (row.clientId !== clientId) return bad("invalid_grant", "Code was issued to a different client");
  if (row.redirectUri !== redirectUri) return bad("invalid_grant", "redirect_uri does not match the authorization request");
  if (!pkceOk(verifier, row.codeChallenge)) return bad("invalid_grant", "PKCE verification failed");
  if (resource !== undefined && resource !== "") {
    if (!sameResource(resource, resourceUrl()) || (row.resource && !sameResource(resource, row.resource))) {
      return bad("invalid_target", "resource does not match the authorization request");
    }
  }
  return { ok: true, body: newPair(db, clientId, row.scope || SCOPE_READ, now) };
}

export function refresh(db: DB, f: Form, now = Date.now()): TokenResult {
  const { client_id: clientId, refresh_token: token } = f;
  if (!clientId || !token) return bad("invalid_request", "client_id and refresh_token are required");
  const client = db.select().from(schema.oauthClients).where(eq(schema.oauthClients.clientId, clientId)).get();
  if (!client) return bad("invalid_client", "Unknown client", 401);

  const hash = sha256Hex(token);
  const row = db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.refreshHash, hash)).get();
  if (!row || row.clientId !== clientId) return bad("invalid_grant", "Unknown refresh token");
  if (row.revokedAt !== null) {
    // A rotated-out token showing up again means two parties hold it: revoke everything for this client.
    revokeClientTokens(db, clientId, now);
    return bad("invalid_grant", "Refresh token was already used or revoked");
  }
  if (row.refreshExpiresAt <= now) return bad("invalid_grant", "Refresh token expired");

  // Rotate: the UPDATE only matches a live row, so a parallel replay falls into the reuse branch.
  const revoked = db
    .update(schema.oauthTokens)
    .set({ revokedAt: now })
    .where(and(eq(schema.oauthTokens.id, row.id), isNull(schema.oauthTokens.revokedAt)))
    .run().changes;
  if (revoked !== 1) {
    revokeClientTokens(db, clientId, now);
    return bad("invalid_grant", "Refresh token was already used or revoked");
  }
  // A refresh can ask for fewer scopes, never more.
  let scope = row.scope;
  if (f.scope) {
    const asked = f.scope.split(/\s+/).filter(Boolean);
    const have = row.scope.split(" ");
    if (asked.some((s) => !have.includes(s))) return bad("invalid_scope", "Cannot widen the granted scope");
    scope = asked.join(" ");
  }
  return { ok: true, body: newPair(db, clientId, scope, now) };
}

// RFC 7009. Always succeeds from the caller's point of view; unknown tokens are ignored.
export function revokeToken(db: DB, token: string, clientId: string | undefined, now = Date.now()): void {
  const hash = sha256Hex(token);
  const rows = [
    db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.accessHash, hash)).get(),
    db.select().from(schema.oauthTokens).where(eq(schema.oauthTokens.refreshHash, hash)).get(),
  ];
  for (const row of rows) {
    if (!row || (clientId && row.clientId !== clientId)) continue;
    db.update(schema.oauthTokens)
      .set({ revokedAt: now })
      .where(and(eq(schema.oauthTokens.id, row.id), isNull(schema.oauthTokens.revokedAt)))
      .run();
  }
}

export type AccessInfo = { tokenId: number; clientId: string; scopes: Scope[]; expiresAt: number };

const TOUCH_EVERY_MS = 60 * 1000;

// Bearer token -> who it belongs to, or null when unknown, expired or revoked. Updates last_used_at (at most once a minute).
export function verifyAccessToken(db: DB, token: string, now = Date.now()): AccessInfo | null {
  if (!token || token.length > 200) return null;
  const row = db
    .select()
    .from(schema.oauthTokens)
    .where(and(eq(schema.oauthTokens.accessHash, sha256Hex(token)), isNull(schema.oauthTokens.revokedAt), gt(schema.oauthTokens.accessExpiresAt, now)))
    .get();
  if (!row) return null;
  if (row.lastUsedAt === null || now - row.lastUsedAt > TOUCH_EVERY_MS) {
    db.update(schema.oauthTokens).set({ lastUsedAt: now }).where(eq(schema.oauthTokens.id, row.id)).run();
  }
  return { tokenId: row.id, clientId: row.clientId, scopes: row.scope.split(" ").filter(isScope), expiresAt: row.accessExpiresAt };
}

export type ConnectedApp = {
  clientId: string;
  name: string;
  scope: string;
  connectedAt: number;
  lastUsedAt: number | null;
};

// Clients that still hold a live (unrevoked, refresh not expired) token, newest first.
export function listConnectedApps(db: DB, now = Date.now()): ConnectedApp[] {
  const rows = db.$client
    .prepare(
      `SELECT c.client_id AS clientId, COALESCE(c.client_name, 'Unnamed app') AS name,
              MAX(t.created_at) AS connectedAt, MAX(t.last_used_at) AS lastUsedAt,
              (SELECT scope FROM oauth_tokens x WHERE x.client_id = c.client_id AND x.revoked_at IS NULL
                 AND x.refresh_expires_at > ? ORDER BY x.created_at DESC LIMIT 1) AS scope
       FROM oauth_clients c JOIN oauth_tokens t ON t.client_id = c.client_id
       WHERE t.revoked_at IS NULL AND t.refresh_expires_at > ?
       GROUP BY c.client_id ORDER BY connectedAt DESC`,
    )
    .all(now, now) as ConnectedApp[];
  return rows;
}
