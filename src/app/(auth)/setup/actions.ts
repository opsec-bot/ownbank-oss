"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cookieOptions, SESSION_COOKIE } from "@/lib/auth/cookie";
import { clientIp } from "@/lib/auth/request";
import { completeSetup } from "@/lib/auth/setup";
import { getDb } from "@/lib/db";

export type SetupState = { error?: string };

export async function setupAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  const h = await headers();
  const result = await completeSetup(
    {
      code: String(form.get("code") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      confirm: String(form.get("confirm") ?? ""),
      ip: await clientIp(),
      userAgent: h.get("user-agent"),
    },
    getDb(),
  );
  if (!result.ok) return { error: result.error };
  (await cookies()).set(SESSION_COOKIE, result.token, cookieOptions(h.get("host")));
  redirect("/settings/bank");
}
