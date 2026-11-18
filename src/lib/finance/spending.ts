import type { DB } from "@/lib/db";
import { addMonthsStart, monthEnd, monthStart, sameDayInMonth } from "./dates";
import { tradingFlows } from "./stats";

// Spending breakdown for the Spending page. Expense-kind and uncategorized transactions only (transfers and income
// excluded), net of refunds. Dates are inclusive YYYY-MM-DD.

export type Comparison = {
  cents: number; // selected month, up to the point
  lastSameCents: number; // previous month up to the same day-of-month
  lastFullCents: number; // whole previous month
  avg3Cents: number | null; // average of the 3 full months before the selected one (months the history covers)
  pctVsAvg: number | null; // percent above (+) or below (-) the 3-month average at the same point
};

export type CategoryRow = Comparison & { key: string; name: string }; // key: category id, "none" or "trading"
export type MerchantRow = Comparison & { merchantKey: string; count: number; avgTicketCents: number };

const EXPENSE = `COALESCE(c.kind, 'expense') = 'expense'`;

export type Periods = {
  month: string; // YYYY-MM-01
  from: string;
  point: string; // last day counted (today for the current month, month end otherwise)
  lastFrom: string;
  lastSame: string;
  lastTo: string;
  prior: { from: string; to: string; samePoint: string }[]; // the 3 months before, only those fully covered by history
};

export function periods(month: string, today: string, earliest: string | null): Periods {
  const from = monthStart(month);
  const current = today.slice(0, 7) === from.slice(0, 7);
  const point = current ? today : monthEnd(from);
  const lastFrom = addMonthsStart(from, -1);
  const prior: Periods["prior"] = [];
  for (let k = 1; k <= 3; k++) {
    const f = addMonthsStart(from, -k);
    if (earliest === null || f < earliest) continue; // partly before our history: not a fair month
    prior.push({ from: f, to: monthEnd(f), samePoint: sameDayInMonth(point, -k) });
  }
  return { month: from, from, point, lastFrom, lastSame: sameDayInMonth(point, -1), lastTo: monthEnd(lastFrom), prior };
}

function pct(cents: number, avg: number | null): number | null {
  return avg !== null && avg > 0 ? Math.round(((cents - avg) / avg) * 100) : null;
}

function compare(cents: number, lastSame: number, lastFull: number, priorSame: number[]): Comparison {
  const avg = priorSame.length ? Math.round(priorSame.reduce((s, v) => s + v, 0) / priorSame.length) : null;
  return { cents, lastSameCents: lastSame, lastFullCents: lastFull, avg3Cents: avg, pctVsAvg: pct(cents, avg) };
}

type Totals = Map<string, { name: string; cents: number }>;

function categoryTotals(db: DB, from: string, to: string): Totals {
  const rows = db.$client
    .prepare(
      `SELECT COALESCE(CAST(c.id AS TEXT), 'none') AS key, COALESCE(c.name, 'Uncategorized') AS name, SUM(-t.amount_cents) AS cents
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.date >= ? AND t.date <= ? AND ${EXPENSE}
       GROUP BY key`,
    )
    .all(from, to) as { key: string; name: string; cents: number }[];
  const out: Totals = new Map(rows.map((r) => [r.key, { name: r.name, cents: r.cents }]));
  const funded = tradingFlows(db, from, to).fundedCents;
  if (funded > 0) out.set("trading", { name: "Memecoin trading", cents: funded });
  return out;
}

export function categoryBreakdown(db: DB, p: Periods): CategoryRow[] {
  const now = categoryTotals(db, p.from, p.point);
  const lastSame = categoryTotals(db, p.lastFrom, p.lastSame);
  const lastFull = categoryTotals(db, p.lastFrom, p.lastTo);
  const priors = p.prior.map((m) => categoryTotals(db, m.from, m.samePoint));
  const keys = new Set<string>([...now.keys()]);
  for (const m of [lastSame, lastFull, ...priors]) for (const k of m.keys()) keys.add(k);
  const name = (k: string) => now.get(k)?.name ?? lastFull.get(k)?.name ?? lastSame.get(k)?.name ?? priors.find((m) => m.has(k))?.get(k)?.name ?? k;
  return [...keys]
    .map((k) => ({
      key: k,
      name: name(k),
      ...compare(
        now.get(k)?.cents ?? 0,
        lastSame.get(k)?.cents ?? 0,
        lastFull.get(k)?.cents ?? 0,
        priors.map((m) => m.get(k)?.cents ?? 0),
      ),
    }))
    .filter((r) => r.cents > 0 || r.lastFullCents > 0)
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
}

type MerchantTotals = Map<string, { cents: number; count: number }>;

// category: a category id, "none" for uncategorized, or null for every expense category.
function merchantTotals(db: DB, from: string, to: string, category: string | null): MerchantTotals {
  const where = [`t.date >= ?`, `t.date <= ?`, EXPENSE];
  const params: (string | number)[] = [from, to];
  if (category === "none") where.push("t.category_id IS NULL");
  else if (category) {
    where.push("t.category_id = ?");
    params.push(Number(category));
  }
  const rows = db.$client
    .prepare(
      `SELECT COALESCE(t.merchant_key, 'unknown') AS mk, SUM(-t.amount_cents) AS cents, COUNT(*) AS n
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${where.join(" AND ")} GROUP BY mk`,
    )
    .all(...params) as { mk: string; cents: number; n: number }[];
  return new Map(rows.map((r) => [r.mk, { cents: r.cents, count: r.n }]));
}

export function merchantBreakdown(db: DB, p: Periods, category: string | null, limit = 50): MerchantRow[] {
  const now = merchantTotals(db, p.from, p.point, category);
  const lastSame = merchantTotals(db, p.lastFrom, p.lastSame, category);
  const lastFull = merchantTotals(db, p.lastFrom, p.lastTo, category);
  const priors = p.prior.map((m) => merchantTotals(db, m.from, m.samePoint, category));
  return [...now.entries()]
    .map(([mk, v]) => ({
      merchantKey: mk,
      count: v.count,
      avgTicketCents: v.count ? Math.round(v.cents / v.count) : 0,
      ...compare(v.cents, lastSame.get(mk)?.cents ?? 0, lastFull.get(mk)?.cents ?? 0, priors.map((m) => m.get(mk)?.cents ?? 0)),
    }))
    .filter((r) => r.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.merchantKey.localeCompare(b.merchantKey))
    .slice(0, limit);
}

// Months that have transactions, newest first, for the month picker.
export function monthsWithData(db: DB, today: string): string[] {
  const rows = db.$client.prepare(`SELECT DISTINCT substr(date, 1, 7) AS m FROM transactions ORDER BY m DESC`).all() as { m: string }[];
  const months = rows.map((r) => r.m);
  const cur = today.slice(0, 7);
  if (!months.includes(cur)) months.unshift(cur);
  return months;
}
