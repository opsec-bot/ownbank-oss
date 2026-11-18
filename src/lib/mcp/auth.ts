import { createHash, timingSafeEqual } from "node:crypto";
import { getDb, type DB } from "@/lib/db";
import { metadataUrl, SCOPE_READ, SCOPE_WRITE, writeEnabled, type Scope } from "@/lib/oauth/config";
import { verifyAccessToken } from "@/lib/oauth/tokens";
import { allowHit } from "@/lib/rate-limit";

export type Principal = {
  kind: "static" | "oauth";
  scopes: Scope[];
  clientId: string | null;
  rateKey: string;
};

export const MCP_RATE_WINDOW_MS = 60 * 1000;
export const MCP_RATE_MAX = 60;

export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
}

// Both sides are hashed first so the comparison is constant time whatever the lengths.
export function staticTokenMatches(given: string, expected: string | undefined = process.env.MCP_TOKEN): boolean {
  if (!expected) return false; // MCP_TOKEN unset: static auth is off
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// The static token is the owner's own: read, plus write when write tools are switched on.
export function staticScopes(): Scope[] {
  return writeEnabled() ? [SCOPE_READ, SCOPE_WRITE] : [SCOPE_READ];
}

export function authenticate(authHeader: string | null | undefined, db: DB = getDb(), now = Date.now()): Principal | null {
  const token = bearerToken(authHeader);
  if (!token || token.length > 300) return null;
  if (staticTokenMatches(token)) return { kind: "static", scopes: staticScopes(), clientId: null, rateKey: "mcp:static" };
  const info = verifyAccessToken(db, token, now);
  if (!info) return null;
  return { kind: "oauth", scopes: info.scopes, clientId: info.clientId, rateKey: `mcp:oauth:${info.tokenId}` };
}

// 60 requests per minute per token.
export function withinRateLimit(p: Principal, db: DB = getDb(), now = Date.now()): boolean {
  return allowHit(p.rateKey, MCP_RATE_WINDOW_MS, MCP_RATE_MAX, db, now);
}

export function unauthorizedHeader(): string {
  return `Bearer resource_metadata="${metadataUrl()}"`;
}

export function hasScope(p: Principal, scope: Scope): boolean {
  return p.scopes.includes(scope);
}
