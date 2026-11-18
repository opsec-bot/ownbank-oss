import { eq } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { addMonthsStart, monthEnd, monthStart } from "./dates";

// Category budgets. Spent = net expense for the category this month (refunds count against it). All cents.

export const WARN_PACE = 1.15; // pace above this shows amber
export const PACE_ALERT = 1.25; // mid-month pace alert threshold
export const PACE_ALERT_MIN_DAY = 10;
export const THRESHOLDS = [100, 80] as const; // percent of limit, highest first

export type BudgetStatus = "ok" | "warn" | "over";

export type BudgetRow = {
  categoryId: number;
  name: string;
  color: string;
  limitCents: number;
  spentCents: number;
  pct: number; // whole percent of limit spent
  fractionElapsed: number; // share of the month gone, 0..1
  pace: number | null; // spent / (limit * fractionElapsed)
  status: BudgetStatus;
};

// Share of the month elapsed, counting today as elapsed: day 15 of 30 = 0.5.
export function fractionElapsed(today: string): number {
  const day = Number(today.slice(8, 10));
  const days = Number(monthEnd(today).slice(8, 10));
  return day / days;
}

// Pure. pace = spent / (limit * fraction of month elapsed). 1.0 means exactly on pace.
export function budgetPace(spentCents: number, limitCents: number, fraction: number): number | null {
  if (limitCents <= 0 || fraction <= 0) return null;
  return spentCents / (limitCents * fraction);
}

export function budgetStatus(spentCents: number, limitCents: number, pace: number | null): BudgetStatus {
  if (limitCents > 0 && spentCents >= limitCents) return "over";
  if (pace !== null && pace > WARN_PACE) return "warn";
  return "ok";
}

export function makeBudgetRow(
  b: { categoryId: number; name: string; color: string; limitCents: number },
  spentCents: number,
  today: string,
): BudgetRow {
  const fraction = fractionElapsed(today);
  const pace = budgetPace(spentCents, b.limitCents, fraction);
  return {
    ...b,
    spentCents,
    pct: b.limitCents > 0 ? Math.round((spentCents / b.limitCents) * 100) : 0,
    fractionElapsed: fraction,
    pace,
    status: budgetStatus(spentCents, b.limitCents, pace),
  };
}

function spentByCategory(db: DB, from: string, to: string): Map<number, number> {
  const rows = db.$client
    .prepare(
      `SELECT t.category_id AS id, SUM(-t.amount_cents) AS cents FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE t.date >= ? AND t.date <= ? AND c.kind = 'expense' GROUP BY t.category_id`,
    )
    .all(from, to) as { id: number; cents: number }[];
  return new Map(rows.map((r) => [r.id, r.cents]));
}

export function loadBudgets(db: DB, today: string): BudgetRow[] {
  const rows = db
    .select({
      categoryId: schema.budgets.categoryId,
      limitCents: schema.budgets.monthlyLimitCents,
      name: schema.categories.name,
      color: schema.categories.color,
    })
    .from(schema.budgets)
    .innerJoin(schema.categories, eq(schema.categories.id, schema.budgets.categoryId))
    .all();
  const spent = spentByCategory(db, monthStart(today), today);
  return rows
    .map((b) => makeBudgetRow(b, Math.max(0, spent.get(b.categoryId) ?? 0), today))
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
}

export function setBudget(db: DB, categoryId: number, limitCents: number, now = Date.now()) {
  db.insert(schema.budgets)
    .values({ categoryId, monthlyLimitCents: limitCents, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: schema.budgets.categoryId, set: { monthlyLimitCents: limitCents, updatedAt: now } })
    .run();
}

export function removeBudget(db: DB, categoryId: number) {
  db.delete(schema.budgets).where(eq(schema.budgets.categoryId, categoryId)).run();
}

export type LimitSuggestion = { categoryId: number; name: string; avgCents: number; suggestedCents: number; months: number };

// Round to the nearest $10, never below $10.
export function roundLimit(avgCents: number): number {
  return Math.max(1000, Math.round(avgCents / 1000) * 1000);
}

// 3 month average per expense category over the full months before this one that the history covers.
// Skips categories that already have a budget. Biggest first.
export function suggestLimits(db: DB, today: string, earliest: string | null): LimitSuggestion[] {
  const months: { from: string; to: string }[] = [];
  for (let k = 1; k <= 3; k++) {
    const from = addMonthsStart(today, -k);
    if (earliest === null || from < earliest) continue; // partly before our history
    months.push({ from, to: monthEnd(from) });
  }
  if (months.length === 0) return [];
  const totals = new Map<number, number>();
  for (const m of months) for (const [id, c] of spentByCategory(db, m.from, m.to)) totals.set(id, (totals.get(id) ?? 0) + c);
  const have = new Set(db.select({ id: schema.budgets.categoryId }).from(schema.budgets).all().map((b) => b.id));
  const names = new Map(db.select().from(schema.categories).all().map((c) => [c.id, c.name]));
  const out: LimitSuggestion[] = [];
  for (const [id, total] of totals) {
    const avg = Math.round(total / months.length);
    if (avg <= 0 || have.has(id) || !names.has(id)) continue;
    out.push({ categoryId: id, name: names.get(id)!, avgCents: avg, suggestedCents: roundLimit(avg), months: months.length });
  }
  return out.sort((a, b) => b.avgCents - a.avgCents || a.name.localeCompare(b.name));
}

export type BudgetAlert = { key: string; level: 100 | 80 | "pace"; categoryId: number; title: string; body: string };

function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

// Pure. Which alerts a budget row calls for right now. At most one per category: the highest threshold crossed, else a
// mid-month pace warning (day >= 10, pace > 1.25, below 80%). Keys are stable per category + month + level, so the
// notifier's dedupe sends each one once.
export function budgetAlerts(rows: BudgetRow[], today: string): BudgetAlert[] {
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const out: BudgetAlert[] = [];
  for (const r of rows) {
    const gone = `${Math.round(r.fractionElapsed * 100)}% of the month gone`;
    const base = `${dollars(r.spentCents)} of ${dollars(r.limitCents)} (${r.pct}%) with ${gone}`;
    const level = THRESHOLDS.find((t) => r.limitCents > 0 && r.spentCents * 100 >= r.limitCents * t);
    if (level === 100) {
      out.push({ key: `budget:${r.categoryId}:${month}:100`, level, categoryId: r.categoryId, title: `${r.name} over budget`, body: `${r.name}: ${base}` });
    } else if (level === 80) {
      out.push({ key: `budget:${r.categoryId}:${month}:80`, level, categoryId: r.categoryId, title: `${r.name} at 80%`, body: `${r.name}: ${base}` });
    } else if (day >= PACE_ALERT_MIN_DAY && r.pace !== null && r.pace > PACE_ALERT) {
      out.push({ key: `budget:${r.categoryId}:${month}:pace`, level: "pace", categoryId: r.categoryId, title: `${r.name} running hot`, body: `${r.name}: ${base}` });
    }
  }
  return out;
}
