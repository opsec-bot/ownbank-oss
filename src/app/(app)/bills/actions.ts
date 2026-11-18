"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/request";
import { getDb, schema } from "@/lib/db";

function back(kind: "ok" | "e", message: string): never {
  redirect(`/bills?${kind}=${encodeURIComponent(message.slice(0, 200))}`);
}

// "Not a bill": keeps the row (so a rebuild does not bring it back) but hides it everywhere.
export async function ignoreBillAction(formData: FormData) {
  await requireSession();
  const key = String(formData.get("key") ?? "");
  const ignored = formData.get("ignored") === "1";
  getDb().update(schema.recurringCharges).set({ ignored }).where(eq(schema.recurringCharges.merchantKey, key)).run();
  back("ok", ignored ? "Hidden. It will not count as a bill." : "Restored.");
}

export async function removeManualBillAction(formData: FormData) {
  await requireSession();
  const key = String(formData.get("key") ?? "");
  const row = getDb().select().from(schema.recurringCharges).where(eq(schema.recurringCharges.merchantKey, key)).get();
  if (row?.manual) getDb().delete(schema.recurringCharges).where(eq(schema.recurringCharges.merchantKey, key)).run();
  back("ok", "Removed.");
}

const CADENCES = ["weekly", "biweekly", "monthly", "yearly"] as const;

export async function addBillAction(formData: FormData) {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const dollars = Number(String(formData.get("amount") ?? "").replace(/[$,]/g, ""));
  const cadence = String(formData.get("cadence") ?? "monthly");
  const next = String(formData.get("next") ?? "");
  const income = formData.get("income") === "1";
  if (!name) back("e", "Name it first.");
  if (!Number.isFinite(dollars) || dollars <= 0 || dollars > 1_000_000) back("e", "Amount must be a positive number.");
  if (!(CADENCES as readonly string[]).includes(cadence)) back("e", "Pick how often.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || Number.isNaN(Date.parse(`${next}T00:00:00Z`))) back("e", "Pick the next date.");
  const cents = Math.round(dollars * 100);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
  const key = `manual:${slug}`;
  const row = {
    displayName: name,
    cadence: cadence as (typeof CADENCES)[number],
    avgAmountCents: income ? cents : -cents,
    lastDate: next,
    nextExpected: next,
    occurrences: 0,
    categoryId: null,
    ignored: false,
    manual: true,
  };
  getDb()
    .insert(schema.recurringCharges)
    .values({ merchantKey: key, ...row })
    .onConflictDoUpdate({ target: schema.recurringCharges.merchantKey, set: row })
    .run();
  back("ok", `Added ${name}.`);
}
