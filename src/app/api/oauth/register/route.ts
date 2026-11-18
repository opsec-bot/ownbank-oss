import { getDb } from "@/lib/db";
import { registerClient } from "@/lib/oauth/clients";
import { ipFromHeaders, jsonResponse, oauthError, preflight, retryAfterSeconds } from "@/lib/oauth/http";
import { allowHit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW = 60 * 1000;

// RFC 7591 dynamic client registration (public clients only). Open on purpose: it grants nothing by itself,
// the owner still has to sign in and approve on the consent page.
export async function POST(req: Request) {
  if (!allowHit(`oauth:register:${ipFromHeaders(req.headers)}`, WINDOW, 10)) {
    return oauthError("slow_down", "Too many requests", 429, { "Retry-After": retryAfterSeconds(WINDOW) });
  }
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 20_000) return oauthError("invalid_client_metadata", "Body too large");
    body = JSON.parse(text);
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON");
  }
  const r = registerClient(body, getDb());
  if (!r.ok) return oauthError(r.error, r.description);
  return jsonResponse(r.body, 201);
}

export function OPTIONS() {
  return preflight();
}
