import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lt } from "drizzle-orm";
import { parseKey } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import { getClient, type OAuthClient } from "./clients";
import { CODE_TTL_MS, grantableScopes, isScope, resourceUrl, SCOPE_READ, type Scope } from "./config";

export type AuthorizeRequest = {
  client: OAuthClient;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scopes: Scope[];
  resource: string | null;
};

export type AuthorizeParse =
  | { ok: true; req: AuthorizeRequest }
  // Bad client or redirect URI: never redirect, show an error page.
  | { ok: false; fatal: true; message: string }
  // Everything else goes back to the client's redirect URI as ?error=.
  | { ok: false; fatal: false; redirectUri: string; state: string | null; error: string; description: string };

type Params = Record<string, string | undefined>;

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function sameResource(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

// Validates an authorization request (query on GET, hidden fields on the consent POST).
export function parseAuthorize(p: Params, db: DB): AuthorizeParse {
  const client = getClient(db, p.client_id);
  if (!client) return { ok: false, fatal: true, message: "Unknown client. Add the connector again." };
  if (!p.redirect_uri || !client.redirectUris.includes(p.redirect_uri)) {
    return { ok: false, fatal: true, message: "The redirect address does not match this client." };
  }
  const redirectUri = p.redirect_uri;
  const state = p.state && p.state.length <= 2000 ? p.state : null;
  const fail = (error: string, description: string): AuthorizeParse => ({ ok: false, fatal: false, redirectUri, state, error, description });

  if (p.response_type !== "code") return fail("unsupported_response_type", "response_type must be code");
  if (!p.code_challenge || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)) {
    return fail("invalid_request", "A valid S256 code_challenge is required");
  }
  if (p.code_challenge_method !== "S256") return fail("invalid_request", "code_challenge_method must be S256");

  let resource: string | null = null;
  if (p.resource) {
    if (!sameResource(p.resource, resourceUrl())) return fail("invalid_target", "resource must be the MCP endpoint of this server");
    resource = resourceUrl();
  }

  const requested = (p.scope ?? "").split(/\s+/).filter(Boolean);
  if (requested.some((s) => !isScope(s))) return fail("invalid_scope", "Unknown scope");
  // Write is only granted when asked for AND turned on server side. Read is the floor.
  const allowed = grantableScopes();
  let scopes = (requested as Scope[]).filter((s, i, a) => allowed.includes(s) && a.indexOf(s) === i);
  if (scopes.length === 0) scopes = [SCOPE_READ];

  return { ok: true, req: { client, redirectUri, state, codeChallenge: p.code_challenge, scopes, resource } };
}

// Stores a one-time code (SHA-256 only) valid for 60 seconds and returns the raw value for the redirect.
export function issueCode(db: DB, req: AuthorizeRequest, now = Date.now()): string {
  const code = randomBytes(32).toString("base64url");
  db.insert(schema.oauthCodes)
    .values({
      codeHash: sha256Hex(code),
      clientId: req.client.clientId,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      scope: req.scopes.join(" "),
      resource: req.resource,
      expiresAt: now + CODE_TTL_MS,
    })
    .run();
  db.delete(schema.oauthCodes).where(lt(schema.oauthCodes.expiresAt, now - 10 * 60 * 1000)).run();
  return code;
}

export function redirectWith(redirectUri: string, params: Record<string, string | null>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  return u.toString();
}

// CSRF token for the consent form, bound to the owner's session cookie value.
export function consentCsrf(sessionToken: string): string {
  return createHmac("sha256", parseKey(process.env.TOKEN_ENC_KEY)).update(`oauth-consent:${sessionToken}`).digest("hex");
}

export function csrfValid(sessionToken: string, given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(consentCsrf(sessionToken));
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const SCOPE_LABELS: Record<Scope, string> = {
  "finance:read": "See your balances, transactions, bills, budgets and forecasts, and post the daily digest",
  "finance:write": "Also change categories, rules and budgets",
};
