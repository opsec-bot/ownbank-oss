import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, SESSION_COOKIE } from "@/lib/auth/cookie";

// Fast gate only: checks that a session cookie exists. The real check (hash + expiry in SQLite) runs in
// requireSession() in Node layouts and route handlers. The allowlisted API routes do their own auth later.
const PUBLIC_EXACT = new Set([
  "/login",
  "/login/verify",
  "/setup",
  "/api/health",
  "/api/sync",
  "/api/mcp",
  "/manifest.webmanifest",
  "/manifest.json",
  "/sw.js",
  "/favicon.ico",
]);
const PUBLIC_PREFIX = ["/api/oauth/", "/oauth/", "/.well-known/", "/_next/", "/icons/"];
const STATIC_FILE = /\.(png|ico|svg|jpg|webp|txt|webmanifest)$/;

function isPublic(path: string): boolean {
  return PUBLIC_EXACT.has(path) || PUBLIC_PREFIX.some((p) => path.startsWith(p)) || STATIC_FILE.test(path);
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Slide the cookie's lifetime along with the server-side expiry.
  const res = NextResponse.next();
  res.cookies.set(SESSION_COOKIE, cookie, cookieOptions(req.headers.get("host")));
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
