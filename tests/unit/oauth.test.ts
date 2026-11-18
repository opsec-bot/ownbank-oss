import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, schema, type DB } from "@/lib/db";
import { consentCsrf, csrfValid, issueCode, parseAuthorize, redirectWith, s256, sha256Hex } from "@/lib/oauth/authorize";
import { isAllowedRedirectUri, registerClient } from "@/lib/oauth/clients";
import { ACCESS_TTL_MS, appUrl, CODE_TTL_MS, MAX_CLIENTS, REFRESH_TTL_MS, resourceUrl } from "@/lib/oauth/config";
import { authorizationServerMetadata, protectedResourceMetadata } from "@/lib/oauth/metadata";
import { exchangeCode, listConnectedApps, refresh, revokeClientTokens, revokeToken, verifyAccessToken } from "@/lib/oauth/tokens";
import { allowHit } from "@/lib/rate-limit";

const NOW = 1_800_000_000_000;
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
let db: DB;

beforeEach(() => {
  db = openDb(":memory:");
  delete process.env.MCP_WRITE_ENABLED;
});

function register(uri = CLAUDE, name = "Claude"): string {
  const r = registerClient({ redirect_uris: [uri], client_name: name }, db, NOW);
  if (!r.ok) throw new Error(r.description);
  return r.body.client_id as string;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

// Goes through parse + issueCode like the consent page does and returns what the token endpoint needs.
function authorize(clientId: string, extra: Record<string, string> = {}, at = NOW) {
  const p = pkce();
  const parsed = parseAuthorize(
    {
      client_id: clientId,
      redirect_uri: CLAUDE,
      response_type: "code",
      code_challenge: p.challenge,
      code_challenge_method: "S256",
      state: "st",
      ...extra,
    },
    db,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed));
  return { code: issueCode(db, parsed.req, at), verifier: p.verifier, req: parsed.req };
}

function form(clientId: string, a: ReturnType<typeof authorize>, extra: Record<string, string | undefined> = {}) {
  return { grant_type: "authorization_code", client_id: clientId, code: a.code, redirect_uri: CLAUDE, code_verifier: a.verifier, ...extra };
}

describe("redirect URI validation", () => {
  it("allows the Claude callbacks and loopback http", () => {
    for (const u of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
      "http://localhost:6274/oauth/callback",
      "http://127.0.0.1:8080/cb",
      "http://localhost/cb",
    ]) {
      expect(isAllowedRedirectUri(u), u).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const u of [
      "https://evil.com/cb",
      "https://claude.ai/other",
      "https://claude.ai.evil.com/api/mcp/auth_callback",
      "https://claude.ai/api/mcp/auth_callback?x=1",
      "http://claude.ai/api/mcp/auth_callback",
      "http://localhost.evil.com/cb",
      "http://localhost@evil.com/cb",
      "https://localhost/cb",
      "http://10.0.0.1/cb",
      "http://[::1]:3000/cb",
      "http://localhost:3000/cb#frag",
      "javascript:alert(1)",
      "myapp://cb",
      "",
      42,
      null,
    ]) {
      expect(isAllowedRedirectUri(u), String(u)).toBe(false);
    }
  });
});

describe("registration", () => {
  it("registers a public client and returns RFC 7591 fields", () => {
    const r = registerClient({ redirect_uris: [CLAUDE], client_name: "Claude" }, db, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body).toMatchObject({
      client_id_issued_at: Math.floor(NOW / 1000),
      redirect_uris: [CLAUDE],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(String(r.body.client_id)).toMatch(/^ob_[A-Za-z0-9_-]{22}$/);
  });

  it("rejects bad redirect URIs with invalid_redirect_uri", () => {
    for (const body of [{ redirect_uris: ["https://evil.com/cb"] }, { redirect_uris: [CLAUDE, "https://evil.com/cb"] }, { redirect_uris: [] }, {}]) {
      const r = registerClient(body, db, NOW);
      expect(r).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    }
    expect(db.select().from(schema.oauthClients).all()).toHaveLength(0);
  });

  it("rejects other bad metadata", () => {
    expect(registerClient(null, db, NOW)).toMatchObject({ ok: false, error: "invalid_client_metadata" });
    expect(registerClient({ redirect_uris: [CLAUDE], token_endpoint_auth_method: "client_secret_post" }, db, NOW)).toMatchObject({ ok: false });
    expect(registerClient({ redirect_uris: [CLAUDE], grant_types: ["password"] }, db, NOW)).toMatchObject({ ok: false });
  });

  it("caps clients at 20 by deleting the oldest unused", () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_CLIENTS + 5; i++) {
      const r = registerClient({ redirect_uris: [CLAUDE] }, db, NOW + i);
      if (!r.ok) throw new Error("register failed");
      ids.push(r.body.client_id as string);
    }
    const left = db.select().from(schema.oauthClients).all().map((c) => c.clientId);
    expect(left).toHaveLength(MAX_CLIENTS);
    expect(left).not.toContain(ids[0]);
    expect(left).toContain(ids[ids.length - 1]);
  });

  it("never deletes a client that holds a live token", () => {
    const first = register();
    const a = authorize(first);
    expect(exchangeCode(db, form(first, a), NOW).ok).toBe(true);
    for (let i = 0; i < MAX_CLIENTS + 3; i++) registerClient({ redirect_uris: [CLAUDE] }, db, NOW + 1000 + i);
    expect(db.select().from(schema.oauthClients).all().map((c) => c.clientId)).toContain(first);
  });

  it("rate limit helper allows 10 per minute per key", () => {
    const hits = Array.from({ length: 12 }, () => allowHit("oauth:register:1.2.3.4", 60_000, 10, db, NOW));
    expect(hits.filter(Boolean)).toHaveLength(10);
    expect(allowHit("oauth:register:5.6.7.8", 60_000, 10, db, NOW)).toBe(true);
    expect(allowHit("oauth:register:1.2.3.4", 60_000, 10, db, NOW + 60_000)).toBe(true);
  });
});

describe("authorize request parsing", () => {
  const base = (clientId: string, p = pkce()) => ({
    client_id: clientId,
    redirect_uri: CLAUDE,
    response_type: "code",
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  });

  it("is fatal (no redirect) for an unknown client or a redirect URI that is not registered", () => {
    const id = register();
    expect(parseAuthorize({ ...base("nope") }, db)).toMatchObject({ ok: false, fatal: true });
    expect(parseAuthorize({ ...base(id), redirect_uri: "http://localhost:3000/cb" }, db)).toMatchObject({ ok: false, fatal: true });
    expect(parseAuthorize({ ...base(id), redirect_uri: undefined }, db)).toMatchObject({ ok: false, fatal: true });
  });

  it("redirects errors for missing or non-S256 PKCE and a wrong response_type", () => {
    const id = register();
    expect(parseAuthorize({ ...base(id), code_challenge: undefined }, db)).toMatchObject({ ok: false, fatal: false, error: "invalid_request" });
    expect(parseAuthorize({ ...base(id), code_challenge_method: "plain" }, db)).toMatchObject({ ok: false, fatal: false, error: "invalid_request" });
    expect(parseAuthorize({ ...base(id), code_challenge_method: undefined }, db)).toMatchObject({ ok: false, fatal: false });
    expect(parseAuthorize({ ...base(id), response_type: "token" }, db)).toMatchObject({ ok: false, fatal: false, error: "unsupported_response_type" });
  });

  it("defaults scope to read and drops write unless MCP_WRITE_ENABLED", () => {
    const id = register();
    const def = parseAuthorize(base(id), db);
    expect(def.ok && def.req.scopes).toEqual(["finance:read"]);
    const asked = parseAuthorize({ ...base(id), scope: "finance:read finance:write" }, db);
    expect(asked.ok && asked.req.scopes).toEqual(["finance:read"]);
    process.env.MCP_WRITE_ENABLED = "1";
    const on = parseAuthorize({ ...base(id), scope: "finance:read finance:write" }, db);
    expect(on.ok && on.req.scopes).toEqual(["finance:read", "finance:write"]);
    expect(parseAuthorize({ ...base(id), scope: "admin" }, db)).toMatchObject({ ok: false, error: "invalid_scope" });
  });

  it("checks the resource parameter", () => {
    const id = register();
    expect(parseAuthorize({ ...base(id), resource: resourceUrl() }, db).ok).toBe(true);
    expect(parseAuthorize({ ...base(id), resource: resourceUrl() + "/" }, db).ok).toBe(true);
    expect(parseAuthorize({ ...base(id), resource: "https://other.example/api/mcp" }, db)).toMatchObject({ ok: false, error: "invalid_target" });
  });

  it("builds redirects with code and state", () => {
    expect(redirectWith(CLAUDE, { code: "abc", state: "s 1" })).toBe(`${CLAUDE}?code=abc&state=s+1`);
    expect(redirectWith("http://localhost:1/cb?x=1", { error: "access_denied", state: null })).toBe("http://localhost:1/cb?x=1&error=access_denied");
  });

  it("csrf token is bound to the session token", () => {
    const t = consentCsrf("session-a");
    expect(csrfValid("session-a", t)).toBe(true);
    expect(csrfValid("session-b", t)).toBe(false);
    expect(csrfValid("session-a", undefined)).toBe(false);
    expect(csrfValid("session-a", t.slice(0, -1))).toBe(false);
  });
});

describe("authorization code exchange", () => {
  it("issues a token pair for a valid code + verifier", () => {
    const id = register();
    const a = authorize(id, { scope: "finance:read" });
    const r = exchangeCode(db, form(id, a), NOW + 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body).toMatchObject({ token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, scope: "finance:read" });
    expect(r.body.access_token).not.toBe(r.body.refresh_token);
    const row = db.select().from(schema.oauthTokens).get()!;
    expect(row.accessHash).toBe(sha256Hex(r.body.access_token));
    expect(row.accessHash).not.toContain(r.body.access_token);
    expect(row.accessExpiresAt).toBe(NOW + 1000 + ACCESS_TTL_MS);
    expect(row.refreshExpiresAt).toBe(NOW + 1000 + REFRESH_TTL_MS);
    // The code is stored hashed too.
    expect(db.select().from(schema.oauthCodes).get()!.codeHash).toBe(sha256Hex(a.code));
  });

  it("fails PKCE with a wrong verifier, and the code is burned", () => {
    const id = register();
    const a = authorize(id);
    const wrong = randomBytes(32).toString("base64url");
    expect(exchangeCode(db, form(id, a, { code_verifier: wrong }), NOW)).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(exchangeCode(db, form(id, a), NOW)).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("rejects short or malformed verifiers", () => {
    const id = register();
    const a = authorize(id);
    expect(exchangeCode(db, form(id, a, { code_verifier: "short" }), NOW)).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("is single use and revokes tokens it already produced when replayed", () => {
    const id = register();
    const a = authorize(id);
    const first = exchangeCode(db, form(id, a), NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(exchangeCode(db, form(id, a), NOW + 5)).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(verifyAccessToken(db, first.body.access_token, NOW + 10)).toBeNull();
  });

  it("expires after 60 seconds", () => {
    const id = register();
    const a = authorize(id);
    expect(exchangeCode(db, form(id, a), NOW + CODE_TTL_MS + 1)).toMatchObject({ ok: false, error: "invalid_grant" });
    const b = authorize(id);
    expect(exchangeCode(db, form(id, b), NOW + CODE_TTL_MS - 1).ok).toBe(true);
  });

  it("checks client_id and redirect_uri", () => {
    const id = register();
    const other = register();
    expect(exchangeCode(db, form(id, authorize(id), { client_id: other }), NOW)).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(exchangeCode(db, form(id, authorize(id), { redirect_uri: "http://localhost:1/cb" }), NOW)).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(exchangeCode(db, form(id, authorize(id), { client_id: "ghost" }), NOW)).toMatchObject({ ok: false, error: "invalid_client", status: 401 });
  });

  it("rejects a resource that does not match", () => {
    const id = register();
    expect(exchangeCode(db, form(id, authorize(id), { resource: "https://other.example/api/mcp" }), NOW)).toMatchObject({ ok: false, error: "invalid_target" });
    expect(exchangeCode(db, form(id, authorize(id), { resource: resourceUrl() }), NOW).ok).toBe(true);
    expect(exchangeCode(db, form(id, authorize(id, { resource: resourceUrl() }), { resource: resourceUrl() }), NOW).ok).toBe(true);
    expect(exchangeCode(db, form(id, authorize(id)), NOW).ok).toBe(true); // resource omitted is fine
  });

  it("requires every field", () => {
    const id = register();
    const a = authorize(id);
    expect(exchangeCode(db, { grant_type: "authorization_code", client_id: id, code: a.code }, NOW)).toMatchObject({ ok: false, error: "invalid_request" });
  });
});

describe("refresh rotation", () => {
  function pair() {
    const id = register();
    const r = exchangeCode(db, form(id, authorize(id)), NOW);
    if (!r.ok) throw new Error("exchange failed");
    return { id, ...r.body };
  }

  it("rotates: new pair works, old pair is dead", () => {
    const p = pair();
    const r = refresh(db, { client_id: p.id, refresh_token: p.refresh_token }, NOW + 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.access_token).not.toBe(p.access_token);
    expect(verifyAccessToken(db, p.access_token, NOW + 1001)).toBeNull();
    expect(verifyAccessToken(db, r.body.access_token, NOW + 1001)?.clientId).toBe(p.id);
    expect(r.body.scope).toBe(p.scope);
  });

  it("reusing a rotated refresh token revokes the whole client", () => {
    const p = pair();
    const r = refresh(db, { client_id: p.id, refresh_token: p.refresh_token }, NOW + 1000);
    if (!r.ok) throw new Error("refresh failed");
    const replay = refresh(db, { client_id: p.id, refresh_token: p.refresh_token }, NOW + 2000);
    expect(replay).toMatchObject({ ok: false, error: "invalid_grant" });
    // The newest pair, which the legitimate client holds, is dead too.
    expect(verifyAccessToken(db, r.body.access_token, NOW + 2001)).toBeNull();
    expect(refresh(db, { client_id: p.id, refresh_token: r.body.refresh_token }, NOW + 2002)).toMatchObject({ ok: false });
    expect(db.select().from(schema.oauthTokens).all().every((t) => t.revokedAt !== null)).toBe(true);
  });

  it("does not touch other clients on reuse", () => {
    const a = pair();
    const b = pair();
    refresh(db, { client_id: a.id, refresh_token: a.refresh_token }, NOW + 1);
    refresh(db, { client_id: a.id, refresh_token: a.refresh_token }, NOW + 2);
    expect(verifyAccessToken(db, b.access_token, NOW + 3)).not.toBeNull();
  });

  it("rejects wrong client, unknown token and expired refresh", () => {
    const p = pair();
    const other = register();
    expect(refresh(db, { client_id: other, refresh_token: p.refresh_token }, NOW)).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(refresh(db, { client_id: p.id, refresh_token: "nope" }, NOW)).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(refresh(db, { client_id: p.id, refresh_token: p.refresh_token }, NOW + REFRESH_TTL_MS + 1)).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("cannot widen scope on refresh", () => {
    const p = pair();
    expect(refresh(db, { client_id: p.id, refresh_token: p.refresh_token, scope: "finance:read finance:write" }, NOW)).toMatchObject({ ok: false, error: "invalid_scope" });
  });
});

describe("access tokens, revocation and connected apps", () => {
  function pair() {
    const id = register();
    const r = exchangeCode(db, form(id, authorize(id)), NOW);
    if (!r.ok) throw new Error("exchange failed");
    return { id, ...r.body };
  }

  it("verifies until the 1 hour expiry and records last use", () => {
    const p = pair();
    expect(verifyAccessToken(db, p.access_token, NOW + ACCESS_TTL_MS - 1)).toMatchObject({ clientId: p.id, scopes: ["finance:read"] });
    expect(db.select().from(schema.oauthTokens).get()!.lastUsedAt).toBe(NOW + ACCESS_TTL_MS - 1);
    expect(verifyAccessToken(db, p.access_token, NOW + ACCESS_TTL_MS + 1)).toBeNull();
    expect(verifyAccessToken(db, "garbage", NOW)).toBeNull();
    expect(verifyAccessToken(db, p.refresh_token, NOW)).toBeNull(); // a refresh token is not an access token
  });

  it("revoke endpoint logic kills the pair and ignores unknown tokens", () => {
    const p = pair();
    revokeToken(db, "unknown", undefined, NOW);
    expect(verifyAccessToken(db, p.access_token, NOW)).not.toBeNull();
    revokeToken(db, p.access_token, "someone-else", NOW);
    expect(verifyAccessToken(db, p.access_token, NOW)).not.toBeNull();
    revokeToken(db, p.refresh_token, p.id, NOW);
    expect(verifyAccessToken(db, p.access_token, NOW)).toBeNull();
  });

  it("lists connected apps with live tokens and revokes by client", () => {
    const p = pair();
    register(CLAUDE, "Idle client");
    const apps = listConnectedApps(db, NOW);
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ clientId: p.id, name: "Claude", scope: "finance:read" });
    verifyAccessToken(db, p.access_token, NOW + 5);
    expect(listConnectedApps(db, NOW + 6)[0].lastUsedAt).toBe(NOW + 5);
    expect(revokeClientTokens(db, p.id, NOW + 7)).toBe(1);
    expect(listConnectedApps(db, NOW + 8)).toHaveLength(0);
    expect(verifyAccessToken(db, p.access_token, NOW + 8)).toBeNull();
  });
});

describe("discovery metadata", () => {
  it("matches the spec", () => {
    const base = appUrl();
    expect(protectedResourceMetadata()).toEqual({
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      scopes_supported: ["finance:read", "finance:write"],
    });
    expect(authorizationServerMetadata()).toMatchObject({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      revocation_endpoint: `${base}/api/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("s256 matches the RFC 7636 example", () => {
    expect(s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
