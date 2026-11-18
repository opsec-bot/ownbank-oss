import { getDb } from "@/lib/db";
import { ipFromHeaders, jsonResponse, oauthError, preflight, retryAfterSeconds } from "@/lib/oauth/http";
import { exchangeCode, refresh } from "@/lib/oauth/tokens";
import { allowHit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW = 60 * 1000;

export async function formBody(req: Request): Promise<Record<string, string | undefined> | null> {
  try {
    const text = await req.text();
    if (text.length > 20_000) return null;
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of new URLSearchParams(text)) if (!(k in out)) out[k] = v;
    return out;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!allowHit(`oauth:token:${ipFromHeaders(req.headers)}`, WINDOW, 10)) {
    return oauthError("slow_down", "Too many requests", 429, { "Retry-After": retryAfterSeconds(WINDOW) });
  }
  const form = await formBody(req);
  if (!form) return oauthError("invalid_request", "Send application/x-www-form-urlencoded");
  const db = getDb();
  let result;
  if (form.grant_type === "authorization_code") result = exchangeCode(db, form);
  else if (form.grant_type === "refresh_token") result = refresh(db, form);
  else return oauthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
  if (!result.ok) return oauthError(result.error, result.description, result.status);
  return jsonResponse(result.body);
}

export function OPTIONS() {
  return preflight();
}
