"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cookieOptions, SESSION_COOKIE } from "@/lib/auth/cookie";
import { attemptLogin, completeTotpLogin } from "@/lib/auth/login";
import { PENDING_COOKIE, PENDING_TTL_MS, safeNext } from "@/lib/auth/pending";
import { clientIp } from "@/lib/auth/request";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  const h = await headers();
  const result = await attemptLogin({
    email,
    password,
    ip: await clientIp(),
    userAgent: h.get("user-agent"),
    next,
  });
  if (!result.ok) return { error: result.error };
  const jar = await cookies();
  if (result.needsTotp) {
    // Only valid for the code page (path-scoped), five minutes, useless without the code.
    jar.set(PENDING_COOKIE, result.pendingToken, {
      httpOnly: true,
      secure: cookieOptions(h.get("host")).secure,
      sameSite: "lax",
      path: "/login",
      maxAge: PENDING_TTL_MS / 1000,
    });
    redirect("/login/verify");
  }
  jar.set(SESSION_COOKIE, result.token, cookieOptions(h.get("host")));
  redirect(result.next ?? "/dashboard");
}

export async function verifyAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const code = String(form.get("code") ?? "");
  const h = await headers();
  const jar = await cookies();
  const result = await completeTotpLogin({
    pendingToken: jar.get(PENDING_COOKIE)?.value,
    code,
    ip: await clientIp(),
    userAgent: h.get("user-agent"),
  });
  if (!result.ok) return { error: result.error };
  jar.delete({ name: PENDING_COOKIE, path: "/login" });
  jar.set(SESSION_COOKIE, result.token, cookieOptions(h.get("host")));
  redirect(result.next ?? "/dashboard");
}
