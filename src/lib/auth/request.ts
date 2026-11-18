import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "./cookie";
import { validateSession, type SessionUser } from "./session";

// Server components and layouts: redirects to /login when there is no valid session.
export async function requireSession(): Promise<SessionUser> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = validateSession(token);
  if (!user) redirect("/login");
  return user;
}

// Route handlers: returns the user, or a 401 response to return as-is.
export async function requireApiSession(): Promise<SessionUser | NextResponse> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = validateSession(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return user;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("fly-client-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
