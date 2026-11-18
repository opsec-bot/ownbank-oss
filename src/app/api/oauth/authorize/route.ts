import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { validateSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { csrfValid, issueCode, parseAuthorize, redirectWith } from "@/lib/oauth/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sessionToken(req: Request): string | undefined {
  const cookie = req.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return v.join("=");
  }
  return undefined;
}

function go(url: string, status = 302): NextResponse {
  return NextResponse.redirect(url, { status, headers: { "Cache-Control": "no-store" } });
}

// Consent form target. Needs the owner's session AND the CSRF token the consent page embedded. Everything is
// validated again from scratch, the hidden fields are not trusted.
export async function POST(req: Request) {
  const token = sessionToken(req);
  const db = getDb();
  const user = validateSession(token, db);
  if (!user || !token) return go(new URL("/login", req.url).toString(), 303);

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Bad form" }, { status: 400 });
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  if (!csrfValid(token, get("csrf"))) return NextResponse.json({ error: "Bad CSRF token" }, { status: 403 });

  const parsed = parseAuthorize(
    {
      client_id: get("client_id"),
      redirect_uri: get("redirect_uri"),
      response_type: "code",
      code_challenge: get("code_challenge"),
      code_challenge_method: "S256",
      state: get("state"),
      scope: get("scope"),
      resource: get("resource"),
    },
    db,
  );
  if (!parsed.ok) {
    if (parsed.fatal) return NextResponse.json({ error: parsed.message }, { status: 400 });
    return go(redirectWith(parsed.redirectUri, { error: parsed.error, error_description: parsed.description, state: parsed.state }));
  }
  const r = parsed.req;
  if (get("decision") !== "approve") {
    return go(redirectWith(r.redirectUri, { error: "access_denied", error_description: "The owner denied access", state: r.state }));
  }
  const code = issueCode(db, r);
  return go(redirectWith(r.redirectUri, { code, state: r.state }));
}
