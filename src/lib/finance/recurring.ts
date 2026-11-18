import { eq, inArray } from "drizzle-orm";
import { getDb, schema, type DB } from "@/lib/db";

export type Cadence = "weekly" | "biweekly" | "monthly" | "yearly";

export type RecurringInput = {
  merchantKey: string;
  date: string; // YYYY-MM-DD
  amountCents: number;
  label: string; // counterparty or description, for display
  categoryId: number | null;
  categoryName?: string | null;
  hint?: boolean; // description says recurring / autopay / subscription
};

export type RecurringResult = {
  merchantKey: string;
  displayName: string;
  cadence: Cadence;
  avgAmountCents: number;
  lastDate: string;
  nextExpected: string;
  occurrences: number;
  categoryId: number | null;
  variableAmount: boolean; // usage billing: amount varies, timing is regular
};

const CADENCES: { name: Cadence; days: number }[] = [
  { name: "weekly", days: 7 },
  { name: "biweekly", days: 14 },
  { name: "monthly", days: 30.44 },
  { name: "yearly", days: 365.25 },
];
const INTERVAL_TOLERANCE = 0.2;
const AMOUNT_TOLERANCE = 0.15;
const MIN_HITS = 3;

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function addCadence(date: string, cadence: Cadence): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (cadence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (cadence === "biweekly") d.setUTCDate(d.getUTCDate() + 14);
  else if (cadence === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else {
    // Month add that clamps to the end of shorter months (Jan 31 -> Feb 28).
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d.toISOString().slice(0, 10);
}

export const MERGE_WINDOW_DAYS = 2;
export const REGULAR_GAP_DAYS = 4;
// Categories whose merchants are visited, not billed: never auto-detected (manual "add bill" still works).
export const EXCLUDED_CATEGORIES = new Set([
  "Dining",
  "Groceries",
  "Transport",
  "Shopping",
  "Personal transfer",
  "Transfer",
  "Savings transfer",
]);
export const HINT_PATTERN = /recurring|autopay|subscription/i;

// Several charges from one merchant within 2 days of the first are ONE billing event (a hosting provider billing
// two line items on the same day). Amounts are summed and the event is dated at the first charge.
export function mergeBillingEvents<T extends { date: string; amountCents: number }>(
  hits: T[],
  windowDays = MERGE_WINDOW_DAYS,
): { date: string; amountCents: number; first: T; lines: number }[] {
  const sorted = [...hits].sort((a, b) => a.date.localeCompare(b.date));
  const out: { date: string; amountCents: number; first: T; lines: number }[] = [];
  for (const h of sorted) {
    const last = out[out.length - 1];
    if (last && dayNumber(h.date) - dayNumber(last.date) <= windowDays) {
      last.amountCents += h.amountCents;
      last.lines++;
    } else out.push({ date: h.date, amountCents: h.amountCents, first: h, lines: 1 });
  }
  return out;
}

// One merchant's hits (same sign). Returns null when it does not look recurring.
function analyze(hits: RecurringInput[], today: string): RecurringResult | null {
  const events = mergeBillingEvents(hits);
  // A "recurring"/"autopay"/"subscription" hint, or the Subscriptions category, is enough with just 2 events.
  // So is a repeated multi-line bill: two events that each combined 2+ same-day charges (a provider billing line
  // items together every month) is a stronger signal than two lone charges.
  const hinted =
    hits.some((h) => h.hint || h.categoryName === "Subscriptions") ||
    (events.length === 2 && events.every((e) => e.lines >= 2));
  if (events.length < (hinted ? 2 : MIN_HITS)) return null;

  const amounts = events.map((e) => e.amountCents);
  const medAmount = median(amounts);
  if (medAmount === 0) return null;

  const intervals: number[] = [];
  for (let i = 1; i < events.length; i++) intervals.push(dayNumber(events[i].date) - dayNumber(events[i - 1].date));
  const med = median(intervals);
  const cadence = CADENCES.find((c) => Math.abs(med - c.days) <= c.days * INTERVAL_TOLERANCE);
  if (!cadence) return null;
  const fit = intervals.filter((n) => Math.abs(n - cadence.days) <= cadence.days * INTERVAL_TOLERANCE).length;
  if (fit / intervals.length < 0.75) return null;

  const fixed = amounts.every((a) => Math.abs(a - medAmount) <= Math.abs(medAmount) * AMOUNT_TOLERANCE);
  let variable = false;
  if (!fixed) {
    // Usage billing: any amount spread is fine when the timing is very regular (every gap within 4 days).
    const regular = intervals.every((n) => Math.abs(n - cadence.days) <= REGULAR_GAP_DAYS);
    if (!regular) return null;
    variable = true;
  }

  const last = events[events.length - 1];
  // Stopped recurring: nothing for more than two cycles.
  if (dayNumber(today) - dayNumber(last.date) > cadence.days * 2) return null;

  const labels = new Map<string, number>();
  for (const h of hits) labels.set(h.label, (labels.get(h.label) ?? 0) + 1);
  const displayName = [...labels.entries()].sort((a, b) => b[1] - a[1])[0][0];

  return {
    merchantKey: last.first.merchantKey,
    displayName,
    cadence: cadence.name,
    avgAmountCents: Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length),
    lastDate: last.date,
    nextExpected: addCadence(last.date, cadence.name),
    occurrences: events.length,
    categoryId: last.first.categoryId,
    variableAmount: variable,
  };
}

export function detectRecurring(inputs: RecurringInput[], today: string): RecurringResult[] {
  const groups = new Map<string, RecurringInput[]>();
  for (const i of inputs) {
    if (!i.merchantKey || i.amountCents === 0) continue;
    if (i.categoryName && EXCLUDED_CATEGORIES.has(i.categoryName)) continue;
    const k = `${i.amountCents < 0 ? "out" : "in"}|${i.merchantKey}`;
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  }
  // merchant_key is the table's primary key: if a merchant recurs both in and out, keep the one seen more.
  const byKey = new Map<string, RecurringResult>();
  for (const g of groups.values()) {
    const r = analyze(g, today);
    if (!r) continue;
    const prev = byKey.get(r.merchantKey);
    if (!prev || r.occurrences > prev.occurrences) byKey.set(r.merchantKey, r);
  }
  return [...byKey.values()].sort((a, b) => a.merchantKey.localeCompare(b.merchantKey));
}

// Rebuilds recurring_charges from posted transactions. Outflows from visited-not-billed categories and transfers
// are skipped. Inflows only count when categorized Income (paycheck cadence, for the forecast). Replaces the
// auto-detected rows; manual and "not a bill" rows survive.
export function rebuildRecurring(db: DB = getDb(), today: string): number {
  const cats = db.select().from(schema.categories).all();
  const catById = new Map(cats.map((c) => [c.id, c]));

  const rows = db
    .select({
      merchantKey: schema.transactions.merchantKey,
      date: schema.transactions.date,
      amountCents: schema.transactions.amountCents,
      description: schema.transactions.description,
      counterparty: schema.transactions.counterparty,
      categoryId: schema.transactions.categoryId,
    })
    .from(schema.transactions)
    .where(eq(schema.transactions.status, "posted"))
    .all();

  const inputs: RecurringInput[] = [];
  for (const r of rows) {
    if (!r.merchantKey) continue;
    const cat = r.categoryId !== null ? catById.get(r.categoryId) : undefined;
    if (cat?.kind === "transfer") continue;
    if (r.amountCents > 0 && cat?.name !== "Income") continue;
    inputs.push({
      merchantKey: r.merchantKey,
      date: r.date,
      amountCents: r.amountCents,
      label: r.counterparty || r.description,
      categoryId: r.categoryId,
      categoryName: cat?.name ?? null,
      hint: HINT_PATTERN.test(r.description) || HINT_PATTERN.test(r.counterparty ?? ""),
    });
  }

  const found = detectRecurring(inputs, today);
  db.transaction((tx) => {
    // Manual rows and rows the user marked "not a bill" survive a rebuild (the flag must outlive detection).
    const existing = tx.select().from(schema.recurringCharges).all();
    const keep = new Set(found.map((f) => f.merchantKey));
    const stale = existing.filter((e) => !keep.has(e.merchantKey) && !e.manual && !e.ignored).map((e) => e.merchantKey);
    if (stale.length) tx.delete(schema.recurringCharges).where(inArray(schema.recurringCharges.merchantKey, stale)).run();
    for (const f of found) {
      tx.insert(schema.recurringCharges)
        .values(f)
        .onConflictDoUpdate({ target: schema.recurringCharges.merchantKey, set: f })
        .run();
    }
  });
  return found.length;
}
