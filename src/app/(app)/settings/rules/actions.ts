"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/request";
import { getDb, schema } from "@/lib/db";
import { applyRuleChange, previewRule } from "@/lib/finance/recategorize";

type Parsed = {
  field: "description" | "counterparty" | "any";
  matchType: "contains" | "equals" | "regex";
  direction: "out" | "in" | "any";
  pattern: string;
  categoryId: number;
  priority: number;
};

function parse(formData: FormData): Parsed | string {
  const field = String(formData.get("field") ?? "any");
  const matchType = String(formData.get("matchType") ?? "contains");
  const direction = String(formData.get("direction") ?? "out");
  const pattern = String(formData.get("pattern") ?? "").trim();
  const categoryId = Number(formData.get("categoryId"));
  const priority = Number(formData.get("priority") || 0);
  if (field !== "any" && field !== "description" && field !== "counterparty") return "Bad field.";
  if (matchType !== "contains" && matchType !== "equals" && matchType !== "regex") return "Bad match type.";
  if (direction !== "out" && direction !== "in" && direction !== "any") return "Bad direction.";
  if (!pattern) return "Pattern is empty.";
  if (pattern.length > 200) return "Pattern is too long (200 max).";
  if (matchType === "regex") {
    try {
      new RegExp(pattern, "i");
    } catch {
      return "That regex does not compile.";
    }
  }
  if (!Number.isInteger(categoryId) || !db().select().from(schema.categories).where(eq(schema.categories.id, categoryId)).get()) {
    return "Pick a category.";
  }
  if (!Number.isInteger(priority) || priority < -50 || priority > 1000) return "Priority must be a whole number from -50 to 1000.";
  return { field, matchType, direction, pattern, categoryId, priority };
}

const db = () => getDb();

function done(kind: "ok" | "e", message: string): never {
  redirect(`/settings/rules?${kind}=${encodeURIComponent(message.slice(0, 200))}`);
}

export async function createRuleAction(formData: FormData) {
  await requireSession();
  const p = parse(formData);
  if (typeof p === "string") done("e", p);
  db().insert(schema.rules).values({ ...p, createdAt: Date.now() }).run();
  const r = applyRuleChange(db());
  done("ok", `Rule saved. ${r.changed} transaction${r.changed === 1 ? "" : "s"} re-categorized.`);
}

export async function updateRuleAction(formData: FormData) {
  await requireSession();
  const id = Number(formData.get("id"));
  const p = parse(formData);
  if (!Number.isInteger(id)) done("e", "Bad rule id.");
  if (typeof p === "string") done("e", p);
  db().update(schema.rules).set(p).where(eq(schema.rules.id, id)).run();
  const r = applyRuleChange(db());
  done("ok", `Rule updated. ${r.changed} transaction${r.changed === 1 ? "" : "s"} re-categorized.`);
}

export async function toggleRuleAction(formData: FormData) {
  await requireSession();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) done("e", "Bad rule id.");
  const rule = db().select().from(schema.rules).where(eq(schema.rules.id, id)).get();
  if (rule) db().update(schema.rules).set({ enabled: !rule.enabled }).where(eq(schema.rules.id, id)).run();
  const showDefaults = rule?.isDefault ? "&defaults=1" : "";
  const r = applyRuleChange(db());
  redirect(`/settings/rules?ok=${encodeURIComponent(`Rule ${rule?.enabled ? "off" : "on"}. ${r.changed} re-categorized.`)}${showDefaults}`);
}

export async function deleteRuleAction(formData: FormData) {
  await requireSession();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) done("e", "Bad rule id.");
  const rule = db().select().from(schema.rules).where(eq(schema.rules.id, id)).get();
  db().delete(schema.rules).where(eq(schema.rules.id, id)).run();
  const showDefaults = rule?.isDefault ? "&defaults=1" : "";
  const r = applyRuleChange(db());
  redirect(`/settings/rules?ok=${encodeURIComponent(`Rule deleted. ${r.changed} re-categorized.`)}${showDefaults}`);
}

export type PreviewResult = { count: number; sample: string[]; error?: string };

// Called from the rule form while typing. Read only.
export async function previewRuleAction(input: {
  field: string;
  matchType: string;
  direction?: string;
  pattern: string;
}): Promise<PreviewResult> {
  await requireSession();
  const pattern = String(input.pattern ?? "").trim().slice(0, 200);
  if (!pattern) return { count: 0, sample: [] };
  if (input.matchType === "regex") {
    try {
      new RegExp(pattern, "i");
    } catch {
      return { count: 0, sample: [], error: "That regex does not compile." };
    }
  }
  const field = input.field === "description" || input.field === "counterparty" ? input.field : "any";
  const matchType = input.matchType === "equals" || input.matchType === "regex" ? input.matchType : "contains";
  const direction = input.direction === "in" || input.direction === "any" ? input.direction : "out";
  const r = previewRule(db(), { field, matchType, direction, pattern, amountMinCents: null, amountMaxCents: null, categoryId: 0, priority: 0 });
  return { count: r.count, sample: r.sample };
}
