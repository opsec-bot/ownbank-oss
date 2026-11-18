import { getDb } from "@/lib/db";
import { ipFromHeaders, jsonResponse, oauthError, preflight, retryAfterSeconds } from "@/lib/oauth/http";
import { revokeToken } from "@/lib/oauth/tokens";
import { allowHit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW = 60 * 1000;

// RFC 7009. Answers 200 for unknown tokens too, so it cannot be used to probe for valid ones.
export async function POST(req: Request) {
  if (!allowHit(`oauth:revoke:${ipFromHeaders(req.headers)}`, WINDOW, 10)) {
    return oauthError("slow_down", "Too many requests", 429, { "Retry-After": retryAfterSeconds(WINDOW) });
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return oauthError("invalid_request", "Unreadable body");
  }
  if (text.length > 20_000) return oauthError("invalid_request", "Body too large");
  const form = new URLSearchParams(text);
  const token = form.get("token");
  if (!token) return oauthError("invalid_request", "token is required");
  revokeToken(getDb(), token, form.get("client_id") ?? undefined);
  return jsonResponse({}, 200);
}

export function OPTIONS() {
  return preflight();
}
