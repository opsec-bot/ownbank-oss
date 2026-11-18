"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/request";
import { getDb, schema } from "@/lib/db";
import { removeBudget, setBudget } from "@/lib/finance/budgets";

function back(kind: "ok" | "e", message: string, extra = ""): never {
  redirect(`/settings/budgets?${kind}=${encodeURIComponent(message.slice(0, 200))}${extra}`);
}

function parse(formData: FormData): { categoryId: number; cents: number } {
  const categoryId = Number(formData.get("category"));
  const dollars = Number(String(formData.get("limit") ?? "").replace(/[$,]/g, ""));
  if (!Number.isInteger(categoryId)) back("e", "Pick a category.");
  if (!Number.isFinite(dollars) || dollars < 1 || dollars > 1_000_000) back("e", "Limit must be a dollar amount from 1 to 1000000.");
  const cat = getDb().select().from(schema.categories).where(eq(schema.categories.id, categoryId)).get();
  if (!cat || cat.kind !== "expense") back("e", "Budgets only apply to spending categories.");
  return { categoryId, cents: Math.round(dollars * 100) };
}

export async function setBudgetAction(formData: FormData) {
  await requireSession();
  const { categoryId, cents } = parse(formData);
  setBudget(getDb(), categoryId, cents);
  back("ok", "Budget saved.");
}

// Confirming one suggestion keeps the suggestion list open for the rest.
export async function confirmSuggestionAction(formData: FormData) {
  await requireSession();
  const { categoryId, cents } = parse(formData);
  setBudget(getDb(), categoryId, cents);
  back("ok", "Budget saved.", "&suggest=1");
}

export async function removeBudgetAction(formData: FormData) {
  await requireSession();
  const categoryId = Number(formData.get("category"));
  if (!Number.isInteger(categoryId)) back("e", "Bad category.");
  removeBudget(getDb(), categoryId);
  back("ok", "Budget removed.");
}
