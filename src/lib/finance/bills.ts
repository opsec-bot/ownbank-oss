import { asc, eq } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { addCadence, mergeBillingEvents, type Cadence } from "./recurring";
import { daysBetween, shiftDays } from "./dates";

export const PRICE_UP_RATIO = 1.05;
export const NEW_WINDOW_DAYS = 30;

// Monthly cost of a charge at the given cadence (cents, sign kept).
export function monthlyEquivalentCents(amountCents: number, cadence: Cadence): number {
  switch (cadence) {
    case "weekly":
      return Math.round((amountCents * 52) / 12);
    case "biweekly":
      return Math.round((amountCents * 26) / 12);
    case "yearly":
      return Math.round(amountCents / 12);
    default:
      return amountCents;
  }
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type BillFlags = { priceUp: boolean; priceUpPct: number | null; isNew: boolean };

// amountsOldestFirst: absolute amounts of each occurrence. priceUp = the latest is more than 5% above the median of
// the earlier ones. isNew = first seen within the last 30 days.
export function billFlags(amountsOldestFirst: number[], firstSeenDate: string | null, today: string): BillFlags {
  let priceUp = false;
  let priceUpPct: number | null = null;
  if (amountsOldestFirst.length >= 2) {
    const last = Math.abs(amountsOldestFirst[amountsOldestFirst.length - 1]);
    const prev = median(amountsOldestFirst.slice(0, -1).map(Math.abs));
    if (prev > 0 && last > prev * PRICE_UP_RATIO) {
      priceUp = true;
      priceUpPct = Math.round(((last - prev) / prev) * 100);
    }
  }
  const isNew = firstSeenDate !== null && daysBetween(firstSeenDate, today) <= NEW_WINDOW_DAYS && daysBetween(firstSeenDate, today) >= 0;
  return { priceUp, priceUpPct, isNew };
}

export type DueRow = { nextExpected: string | null; cadence: Cadence };

// The date a row is next due, relative to today. A charge up to 5 days late is treated as due tomorrow (it is
// probably still coming); older than that, roll forward by the cadence.
export function effectiveNext(row: DueRow, today: string): string | null {
  if (!row.nextExpected) return null;
  let d = row.nextExpected;
  if (d > today) return d;
  if (daysBetween(d, today) <= 5) return shiftDays(today, 1);
  let guard = 0;
  while (d <= today && guard++ < 500) d = addCadence(d, row.cadence);
  return d;
}

export type Occurrence = { merchantKey: string; name: string; date: string; amountCents: number };

export function upcomingOccurrences(
  rows: { merchantKey: string; displayName: string; cadence: Cadence; avgAmountCents: number; nextExpected: string | null }[],
  today: string,
  toDate: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const r of rows) {
    let d = effectiveNext(r, today);
    let guard = 0;
    while (d && d <= toDate && guard++ < 60) {
      out.push({ merchantKey: r.merchantKey, name: r.displayName, date: d, amountCents: r.avgAmountCents });
      d = addCadence(d, r.cadence);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.merchantKey.localeCompare(b.merchantKey));
}

export type BillItem = {
  merchantKey: string;
  name: string;
  cadence: Cadence;
  avgAmountCents: number; // negative = out
  nextDate: string | null;
  daysUntil: number | null;
  isSubscription: boolean;
  manual: boolean;
  ignored: boolean;
  variableAmount: boolean;
  priceUp: boolean;
  priceUpPct: number | null;
  isNew: boolean;
};

export type BillsView = {
  items: BillItem[]; // outflows, not ignored, sorted by next date
  income: BillItem[];
  ignored: BillItem[];
  dueSoon: BillItem[]; // within 7 days
  monthlyTotalCents: number; // positive number: monthly cost of recurring outflows
};

export function loadBills(db: DB, today: string): BillsView {
  const rows = db.select().from(schema.recurringCharges).orderBy(asc(schema.recurringCharges.merchantKey)).all();
  const subs = db.select().from(schema.categories).where(eq(schema.categories.name, "Subscriptions")).get();
  const txs = db
    .select({ key: schema.transactions.merchantKey, date: schema.transactions.date, amount: schema.transactions.amountCents })
    .from(schema.transactions)
    .where(eq(schema.transactions.status, "posted"))
    .orderBy(asc(schema.transactions.date))
    .all();
  const byKey = new Map<string, { date: string; amount: number }[]>();
  for (const t of txs) {
    if (!t.key) continue;
    const l = byKey.get(t.key);
    if (l) l.push({ date: t.date, amount: t.amount });
    else byKey.set(t.key, [{ date: t.date, amount: t.amount }]);
  }

  const all: BillItem[] = rows.map((r) => {
    // Same-day line items are one billing event, so a price rise compares whole bills.
    const hist = r.manual
      ? []
      : mergeBillingEvents((byKey.get(r.merchantKey) ?? []).filter((h) => (h.amount < 0) === (r.avgAmountCents < 0)).map((h) => ({ date: h.date, amountCents: h.amount })));
    const flags = billFlags(
      hist.map((h) => h.amountCents),
      hist.length ? hist[0].date : null,
      today,
    );
    const nextDate = effectiveNext({ nextExpected: r.nextExpected, cadence: r.cadence }, today);
    return {
      merchantKey: r.merchantKey,
      name: r.displayName,
      cadence: r.cadence,
      avgAmountCents: r.avgAmountCents,
      nextDate,
      daysUntil: nextDate ? daysBetween(today, nextDate) : null,
      isSubscription: subs !== undefined && r.categoryId === subs.id,
      manual: r.manual,
      ignored: r.ignored,
      variableAmount: r.variableAmount,
      // Usage-billed amounts move on purpose, so a rise is not a price change.
      priceUp: flags.priceUp && !r.variableAmount,
      priceUpPct: r.variableAmount ? null : flags.priceUpPct,
      isNew: flags.isNew,
    };
  });

  const byNext = (a: BillItem, b: BillItem) => (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999") || a.name.localeCompare(b.name);
  const live = all.filter((i) => !i.ignored);
  const items = live.filter((i) => i.avgAmountCents < 0).sort(byNext);
  const income = live.filter((i) => i.avgAmountCents > 0).sort(byNext);
  const monthlyTotalCents = -items.reduce((s, i) => s + monthlyEquivalentCents(i.avgAmountCents, i.cadence), 0);
  return {
    items,
    income,
    ignored: all.filter((i) => i.ignored).sort(byNext),
    dueSoon: items.filter((i) => i.daysUntil !== null && i.daysUntil >= 0 && i.daysUntil <= 7),
    monthlyTotalCents,
  };
}

// Active (not ignored) recurring rows in the shape the forecast needs.
export function activeRecurring(db: DB) {
  return db
    .select()
    .from(schema.recurringCharges)
    .all()
    .filter((r) => !r.ignored)
    .map((r) => ({
      merchantKey: r.merchantKey,
      displayName: r.displayName,
      cadence: r.cadence,
      avgAmountCents: r.avgAmountCents,
      nextExpected: r.nextExpected,
    }));
}
