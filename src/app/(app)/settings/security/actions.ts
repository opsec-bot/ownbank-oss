"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/request";
import { verifyPassword } from "@/lib/auth/password";
import {
  beginSetup,
  checkSecondFactor,
  confirmSetup,
  disableTotp,
  getUser,
  replaceRecoveryCodes,
  totpState,
} from "@/lib/auth/totp";
import { getDb } from "@/lib/db";
import { allowHit } from "@/lib/rate-limit";

const WINDOW = 15 * 60 * 1000;

function back(kind: "ok" | "e", message: string): never {
  redirect(`/settings/security?${kind}=${encodeURIComponent(message.slice(0, 200))}`);
}

// Password and code guesses from a signed-in session are capped too.
function tooMany(userId: number): boolean {
  return !allowHit(`security:${userId}`, WINDOW, 10);
}

export type CodesState = { error?: string; codes?: string[] };

export async function startSetupAction(formData: FormData) {
  const user = await requireSession();
  if (tooMany(user.id)) back("e", "Too many attempts. Try again in a few minutes.");
  const db = getDb();
  const row = getUser(db, user.id);
  if (!row) back("e", "No account.");
  if (totpState(row) === "on") back("e", "2FA is already on.");
  if (!(await verifyPassword(row.passwordHash, String(formData.get("password") ?? "")))) back("e", "Wrong password.");
  beginSetup(db, user.id);
  redirect("/settings/security");
}

export async function cancelSetupAction() {
  const user = await requireSession();
  const db = getDb();
  const row = getUser(db, user.id);
  if (row && totpState(row) === "pending") disableTotp(db, user.id);
  back("ok", "Setup cancelled.");
}

// Called from a client form (useActionState): returns the one-time recovery codes instead of redirecting,
// so they exist only in this response and never in a URL or the database in readable form.
export async function confirmSetupAction(_prev: CodesState, formData: FormData): Promise<CodesState> {
  const user = await requireSession();
  if (tooMany(user.id)) return { error: "Too many attempts. Try again in a few minutes." };
  const codes = confirmSetup(getDb(), user.id, String(formData.get("code") ?? ""));
  if (!codes) return { error: "That code did not match. Check the app and try again." };
  return { codes };
}

export async function regenerateAction(_prev: CodesState, formData: FormData): Promise<CodesState> {
  const user = await requireSession();
  if (tooMany(user.id)) return { error: "Too many attempts. Try again in a few minutes." };
  const db = getDb();
  const row = getUser(db, user.id);
  if (!row || totpState(row) !== "on") return { error: "2FA is not on." };
  if (checkSecondFactor(db, user.id, String(formData.get("code") ?? "")) !== "ok") return { error: "That code did not work." };
  return { codes: replaceRecoveryCodes(db, user.id) };
}

export async function disableAction(formData: FormData) {
  const user = await requireSession();
  if (tooMany(user.id)) back("e", "Too many attempts. Try again in a few minutes.");
  const db = getDb();
  const row = getUser(db, user.id);
  if (!row || totpState(row) !== "on") back("e", "2FA is not on.");
  if (!(await verifyPassword(row.passwordHash, String(formData.get("password") ?? "")))) back("e", "Wrong password.");
  if (checkSecondFactor(db, user.id, String(formData.get("code") ?? "")) !== "ok") back("e", "That code did not work.");
  disableTotp(db, user.id);
  back("ok", "2FA is off.");
}
