// Shared OAuth and MCP settings. Reads process.env on each call so tests can change it. No "server-only" so
// unit tests and scripts can import it.

export const SCOPE_READ = "finance:read";
export const SCOPE_WRITE = "finance:write";
export const ALL_SCOPES = [SCOPE_READ, SCOPE_WRITE] as const;
export type Scope = (typeof ALL_SCOPES)[number];

export const ACCESS_TTL_MS = 60 * 60 * 1000; // 1 hour
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const CODE_TTL_MS = 60 * 1000; // 60 seconds
export const MAX_CLIENTS = 20;

// APP_URL without a trailing slash. This is the OAuth issuer and the base of every endpoint URL.
export function appUrl(): string {
  const raw = process.env.APP_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export function resourceUrl(): string {
  return `${appUrl()}/api/mcp`;
}

export function metadataUrl(): string {
  return `${appUrl()}/.well-known/oauth-protected-resource`;
}

function flag(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

// MCP write tools (recategorize, rules, budgets). Off unless MCP_WRITE_ENABLED is 1 or true.
export function writeEnabled(): boolean {
  return flag(process.env.MCP_WRITE_ENABLED);
}

// publish_digest is on unless MCP_DIGEST_ENABLED is 0 or false.
export function digestEnabled(): boolean {
  const v = process.env.MCP_DIGEST_ENABLED;
  return !(v === "0" || v === "false");
}

export function isScope(s: string): s is Scope {
  return (ALL_SCOPES as readonly string[]).includes(s);
}

// What this server can grant right now.
export function grantableScopes(): Scope[] {
  return writeEnabled() ? [SCOPE_READ, SCOPE_WRITE] : [SCOPE_READ];
}
