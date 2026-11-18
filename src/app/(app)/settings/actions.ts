"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/request";
import { connectWithSetupToken } from "@/lib/bank/connect";
import { runSync, type SyncOutcome } from "@/lib/bank/sync";
import { getDb, schema } from "@/lib/db";
import { getGoal } from "@/lib/finance/goal";
import { notify, ntfyFromEnv, vapidFromEnv } from "@/lib/push/send";
import { baselineGoalMilestones } from "@/lib/push/triggers";
import { revokeClientTokens } from "@/lib/oauth/tokens";
import { allowHit } from "@/lib/rate-limit";
import { isValidSolanaAddress, refreshWalletById } from "@/lib/solana/balances";

// Return to the settings page the form was on (Settings is split into sub pages). Only /settings or
// /settings/<word> is accepted from the Referer, so it can never redirect off-site.
async function back(kind: "ok" | "e", message: string): Promise<never> {
  let path = "/settings";
  try {
    const ref = (await headers()).get("referer");
    if (ref) {
      const p = new URL(ref).pathname;
      if (/^\/settings(\/[a-z]+)?$/.test(p)) path = p;
    }
  } catch {
    // bad or missing Referer: fall back to /settings
  }
  redirect(`${path}?${kind}=${encodeURIComponent(message.slice(0, 200))}`);
}

function describe(out: SyncOutcome): string {
  if (out.ok) return `Synced: ${out.stats.accounts} accounts, ${out.stats.inserted} new, ${out.stats.updated} updated, ${out.stats.removed} removed.`;
  return "skipped" in out ? `Sync skipped: ${out.skipped}.` : `Sync failed: ${out.error}`;
}

// Connect (no connection yet) or replace (new token) both end up here.
export async function connectAction(formData: FormData) {
  await requireSession();
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return back("e", "Paste a setup token first.");
  const result = await connectWithSetupToken(token);
  if (!result.ok) return back("e", result.error);
  return back("ok", `Connected. ${describe(result.sync)}`);
}

export async function syncNowAction() {
  await requireSession();
  if (!allowHit("sync:manual", 60 * 60 * 1000, 6)) return back("e", "Too many manual syncs this hour. Try later.");
  return back("ok", describe(await runSync("manual")));
}

export async function addWalletAction(formData: FormData) {
  await requireSession();
  const address = String(formData.get("address") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim().slice(0, 60);
  if (!isValidSolanaAddress(address)) return back("e", "That is not a valid Solana address.");
  const db = getDb();
  if (db.select().from(schema.cryptoWallets).where(eq(schema.cryptoWallets.address, address)).get()) {
    return back("e", "That wallet is already added.");
  }
  const row = db.insert(schema.cryptoWallets).values({ address, label }).returning({ id: schema.cryptoWallets.id }).get();
  await refreshWalletById(row.id);
  return back("ok", "Wallet added.");
}

export async function setWalletRoleAction(formData: FormData) {
  await requireSession();
  const id = Number(formData.get("id"));
  const role = String(formData.get("role"));
  if (!Number.isInteger(id) || (role !== "savings" && role !== "trading")) return back("e", "Bad wallet role.");
  getDb().update(schema.cryptoWallets).set({ role, lastSignature: null }).where(eq(schema.cryptoWallets.id, id)).run();
  return back("ok", role === "trading" ? "Wallet is now a trading wallet (not counted in net worth)." : "Wallet is now a savings wallet.");
}

export async function savePlanSettingsAction(formData: FormData) {
  await requireSession();
  const percent = Number(formData.get("percent"));
  const buffer = Number(String(formData.get("buffer") ?? "").replace(/[$,]/g, ""));
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return back("e", "Save percent must be a whole number from 0 to 100.");
  if (!Number.isFinite(buffer) || buffer < 0 || buffer > 100_000) return back("e", "Buffer must be a dollar amount from 0 to 100000.");
  getDb().update(schema.settings).set({ savePercent: percent, bufferCents: Math.round(buffer * 100) }).where(eq(schema.settings.id, 1)).run();
  return back("ok", "Saved.");
}

export async function removeWalletAction(formData: FormData) {
  await requireSession();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return back("e", "Bad wallet id.");
  getDb().delete(schema.cryptoWallets).where(eq(schema.cryptoWallets.id, id)).run();
  return back("ok", "Wallet removed.");
}

export async function sendTestPushAction() {
  await requireSession();
  if (!allowHit("push:test", 60 * 1000, 5)) return back("e", "Too many test pushes. Wait a minute.");
  if (!vapidFromEnv() && !ntfyFromEnv()) return back("e", "Push is not configured: set the VAPID keys (npm run gen:vapid) or NTFY_TOPIC.");
  const db = getDb();
  if (!ntfyFromEnv() && db.select().from(schema.pushSubscriptions).all().length === 0) return back("e", "No devices yet. Enable notifications on this phone first.");
  const status = await notify(db, { kind: "test", title: "ownbank", body: "Test notification. Push works.", url: "/dashboard", tag: "test" });
  return back(status === "sent" ? "ok" : "e", status === "sent" ? "Test sent." : "The push service rejected it. Check the Alerts list below.");
}

const KIND_COLUMN = {
  digest: "pushDigest",
  income_save: "pushIncomeSave",
  low_balance: "pushLowBalance",
  disconnect: "pushDisconnect",
  large_tx: "pushLargeTx",
  budget_pace: "pushBudgetPace",
  goal: "pushGoal",
} as const;

export async function saveNotificationSettingsAction(formData: FormData) {
  await requireSession();
  const set: Record<string, boolean> = {};
  for (const [kind, column] of Object.entries(KIND_COLUMN)) set[column] = formData.get(kind) === "on";
  const threshold = Number(String(formData.get("threshold") ?? "").replace(/[$,]/g, ""));
  if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100_000) return back("e", "Large transaction threshold must be a dollar amount from 1 to 100000.");
  getDb()
    .update(schema.settings)
    .set({ ...set, largeTxThresholdCents: Math.round(threshold * 100) })
    .where(eq(schema.settings.id, 1))
    .run();
  return back("ok", "Notification settings saved.");
}

export async function saveGoalAction(formData: FormData) {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const target = Number(String(formData.get("target") ?? "").replace(/[$,]/g, ""));
  const date = String(formData.get("date") ?? "").trim();
  const counts = String(formData.get("counts") ?? "stable");
  if (!name) return back("e", "Give the goal a name.");
  if (!Number.isFinite(target) || target < 1 || target > 100_000_000) return back("e", "Target must be a dollar amount.");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return back("e", "Target date must be a date.");
  if (counts !== "stable" && counts !== "all_savings") return back("e", "Bad counts option.");
  const db = getDb();
  const prev = getGoal(db);
  const values = { name, targetCents: Math.round(target * 100), targetDate: date || null, counts: counts as "stable" | "all_savings" };
  if (prev) db.update(schema.savingsGoal).set(values).where(eq(schema.savingsGoal.id, 1)).run();
  else db.insert(schema.savingsGoal).values({ id: 1, ...values, createdAt: Date.now() }).run();
  // Milestones already passed should not push when a goal is created or its target moves.
  baselineGoalMilestones(db);
  return back("ok", "Goal saved.");
}

export async function clearGoalAction() {
  await requireSession();
  getDb().delete(schema.savingsGoal).where(eq(schema.savingsGoal.id, 1)).run();
  return back("ok", "Goal removed.");
}

export async function revokeAppAction(formData: FormData) {
  await requireSession();
  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) return back("e", "Bad app id.");
  revokeClientTokens(getDb(), clientId);
  return back("ok", "App disconnected.");
}
