import { schema, type DB } from "@/lib/db";
import type { Occurrence } from "./bills";
import { futureEvents } from "./income";
import { daysBetween, monthEnd, shiftDays } from "./dates";

export const LOW_BALANCE_CENTS = 5000;
export const DISCRETIONARY_WINDOW_DAYS = 60;

type AcctLike = {
  type: string | null;
  name: string;
  hidden?: boolean;
  balanceAvailableCents: number | null;
  balanceLedgerCents: number | null;
};

export function isSavingsAccount(a: { name: string }): boolean {
  return /sav/i.test(a.name);
}

// Spendable checking cash: depository accounts that are not savings, available balance (falls back to ledger).
export function checkingCents(accounts: AcctLike[]): number {
  let total = 0;
  for (const a of accounts) {
    if (a.hidden || a.type === "credit" || isSavingsAccount(a)) continue;
    total += a.balanceAvailableCents ?? a.balanceLedgerCents ?? 0;
  }
  return total;
}

export function bankCashCents(accounts: AcctLike[]): number {
  let total = 0;
  for (const a of accounts) {
    if (a.hidden || a.type === "credit") continue;
    total += a.balanceLedgerCents ?? 0;
  }
  return total;
}

// Average discretionary spend per day: total outflow over the last 60 days (recurring and transfers already
// removed by the caller) divided by the days of history we really have (14 to 60).
export function dailyDiscretionaryCents(totalOutflowCents: number, earliestDate: string | null, today: string): number {
  const span = earliestDate === null ? 14 : Math.min(DISCRETIONARY_WINDOW_DAYS, Math.max(14, daysBetween(earliestDate, today) + 1));
  return Math.round(Math.max(0, totalOutflowCents) / span);
}

export type Projection = {
  endCents: number;
  lowestCents: number;
  lowestDate: string;
  nextIncomeDate: string | null;
  nextIncomeCents: number | null;
  warn: boolean; // balance dips below the threshold before the next income
  warnDate: string | null;
};

// Day-by-day balance from tomorrow to toDate: start + recurring events due - daily discretionary spend.
export function projectBalance(args: {
  startCents: number;
  today: string;
  toDate: string;
  events: Occurrence[];
  dailySpendCents: number;
  thresholdCents?: number;
}): Projection {
  const { startCents, today, toDate, events, dailySpendCents } = args;
  const threshold = args.thresholdCents ?? LOW_BALANCE_CENTS;
  const income = events.filter((e) => e.amountCents > 0 && e.date > today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const nextIncomeDate = income?.date ?? null;

  let balance = startCents;
  let lowest = startCents;
  let lowestDate = today;
  let warn = false;
  let warnDate: string | null = null;
  const span = Math.max(0, daysBetween(today, toDate));
  for (let i = 1; i <= span; i++) {
    const d = shiftDays(today, i);
    // Income lands at the start of its day, so the dip check for a day stops before it counts.
    const dayEvents = events.filter((e) => e.date === d);
    const out = dayEvents.filter((e) => e.amountCents < 0).reduce((s, e) => s + e.amountCents, 0);
    const inn = dayEvents.filter((e) => e.amountCents > 0).reduce((s, e) => s + e.amountCents, 0);
    balance += out - dailySpendCents;
    if (balance < lowest) {
      lowest = balance;
      lowestDate = d;
    }
    const beforeIncome = nextIncomeDate === null || d < nextIncomeDate;
    if (beforeIncome && balance < threshold && !warn) {
      warn = true;
      warnDate = d;
    }
    balance += inn;
  }
  return {
    endCents: balance,
    lowestCents: lowest,
    lowestDate,
    nextIncomeDate,
    nextIncomeCents: income?.amountCents ?? null,
    warn,
    warnDate,
  };
}

// Loader: outflow total over the discretionary window, excluding transfers and active recurring merchants.
export function loadDailyDiscretionary(db: DB, today: string): number {
  const from = shiftDays(today, -DISCRETIONARY_WINDOW_DAYS);
  const recurringOut = new Set(
    db
      .select()
      .from(schema.recurringCharges)
      .all()
      .filter((r) => !r.ignored && r.avgAmountCents < 0)
      .map((r) => r.merchantKey),
  );
  const rows = db.$client
    .prepare(
      `SELECT t.merchant_key AS k, t.amount_cents AS a FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.date > ? AND t.date <= ? AND t.amount_cents < 0 AND COALESCE(c.kind, 'expense') = 'expense'`,
    )
    .all(from, today) as { k: string | null; a: number }[];
  let total = 0;
  for (const r of rows) {
    if (r.k && recurringOut.has(r.k)) continue;
    total += -r.a;
  }
  const earliest = db.$client.prepare(`SELECT MIN(date) AS d FROM transactions`).get() as { d: string | null };
  return dailyDiscretionaryCents(total, earliest.d, today);
}

export function loadForecast(db: DB, today: string, bufferCents = LOW_BALANCE_CENTS): Projection & { startCents: number } {
  const accounts = db.select().from(schema.accounts).all();
  const start = checkingCents(accounts);
  const events = futureEvents(db, today, monthEnd(today));
  const p = projectBalance({
    startCents: start,
    today,
    toDate: monthEnd(today),
    events,
    dailySpendCents: loadDailyDiscretionary(db, today),
    thresholdCents: bufferCents,
  });
  return { ...p, startCents: start };
}
