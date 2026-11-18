// Small response helpers for the OAuth and discovery routes. These endpoints take no cookies and no ambient
// credentials, so a wildcard CORS origin is safe and lets browser based tools (MCP Inspector) use them.

export function ipFromHeaders(h: Headers): string {
  return h.get("fly-client-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache", ...CORS, ...extra },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

// RFC 6749 section 5.2 error body.
export function oauthError(error: string, description: string, status = 400, extra: Record<string, string> = {}): Response {
  return jsonResponse({ error, error_description: description }, status, extra);
}

export function retryAfterSeconds(windowMs: number, now = Date.now()): string {
  return String(Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000)));
}
