"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/request";
import { localDate } from "@/lib/bank/normalize";
import { getDb, schema } from "@/lib/db";
import { categorize, type RuleRow } from "@/lib/finance/categorize";
import { rebuildRecurring } from "@/lib/finance/recurring";

// Only same-site transaction list URLs are allowed as the place to return to.
function safeReturn(value: FormDataEntryValue | null): string {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/transactions") && !v.includes("//") && !v.includes("\\") ? v : "/transactions";
}

export async function setCategoryAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const categoryId = Number(formData.get("categoryId"));
  const back = safeReturn(formData.get("return"));
  const db = getDb();
  const tx = db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get();
  const cat = Number.isInteger(categoryId) ? db.select().from(schema.categories).where(eq(schema.categories.id, categoryId)).get() : undefined;
  if (tx && cat) {
    db.update(schema.transactions)
      .set({ categoryId: cat.id, categorySource: "manual", updatedAt: Date.now() })
      .where(eq(schema.transactions.id, id))
      .run();
    rebuildRecurring(db, localDate(Math.floor(Date.now() / 1000)));
  }
  redirect(back);
}

// Drops the manual override and lets rules decide again.
export async function resetCategoryAction(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const back = safeReturn(formData.get("return"));
  const db = getDb();
  const tx = db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get();
  if (tx) {
    const cats = db.select().from(schema.categories).all();
    const rules: RuleRow[] = db.select().from(schema.rules).all();
    const c = categorize(
      { description: tx.description, counterparty: tx.counterparty, amountCents: tx.amountCents, mcc: tx.providerCategory },
      rules,
      new Map(cats.map((x) => [x.name, x.id])),
    );
    db.update(schema.transactions)
      .set({ categoryId: c.categoryId, categorySource: c.source, updatedAt: Date.now() })
      .where(eq(schema.transactions.id, id))
      .run();
    rebuildRecurring(db, localDate(Math.floor(Date.now() / 1000)));
  }
  redirect(back);
}
