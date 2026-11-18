import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate, unauthorizedHeader, withinRateLimit, MCP_RATE_WINDOW_MS } from "@/lib/mcp/auth";
import { buildMcpServer } from "@/lib/mcp/server";
import { getDb } from "@/lib/db";
import { ipFromHeaders, retryAfterSeconds } from "@/lib/oauth/http";
import { allowHit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function problem(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE, ...headers },
  });
}

// Auth runs before the transport sees the request. Static MCP_TOKEN or an OAuth access token.
async function handle(req: Request): Promise<Response> {
  const db = getDb();
  const principal = authenticate(req.headers.get("authorization"), db);
  if (!principal) {
    // Failed guesses are capped per IP so the endpoint cannot be hammered for tokens.
    if (!allowHit(`mcp:authfail:${ipFromHeaders(req.headers)}`, MCP_RATE_WINDOW_MS, 30, db)) {
      return problem(429, "Too many failed requests", { "Retry-After": retryAfterSeconds(MCP_RATE_WINDOW_MS) });
    }
    return problem(401, "Unauthorized", { "WWW-Authenticate": unauthorizedHeader() });
  }
  if (!withinRateLimit(principal, db)) {
    return problem(429, "Rate limit: 60 requests per minute", { "Retry-After": retryAfterSeconds(MCP_RATE_WINDOW_MS) });
  }

  // Stateless: a new server and transport for every request, no session ids, plain JSON responses.
  const server = buildMcpServer(principal, { db });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req, { authInfo: { token: "", clientId: principal.clientId ?? "static", scopes: principal.scopes } });
  void server.close().catch(() => undefined);
  return res;
}

export async function POST(req: Request) {
  return handle(req);
}

// A stateless server has nothing to push, so the standalone GET stream is answered with 405 as the spec allows.
// Auth still runs first so an unauthenticated probe gets the 401 + resource metadata challenge.
export async function GET(req: Request) {
  const principal = authenticate(req.headers.get("authorization"), getDb());
  if (!principal) return problem(401, "Unauthorized", { "WWW-Authenticate": unauthorizedHeader() });
  return problem(405, "This server does not offer a GET stream", { Allow: "POST, DELETE" });
}

export async function DELETE(req: Request) {
  return handle(req);
}
