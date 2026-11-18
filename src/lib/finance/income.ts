import type { DB } from "@/lib/db";
import { activeRecurring, upcomingOccurrences, type Occurrence } from "./bills";
import { daysBetween, shiftDays } from "./dates";

export const INCOME_WINDOW_DAYS = 56; // 8 weeks

export type IncomeRate = {
  weeklyCents: number; // trailing average per week
  gapDays: number; // median gap between income days (at least 1)
  medianDepositCents: number; // median income-day total
  lastDate: string;
  nextDate: string; // lastDate + gap, never in the past
  events: number;
};

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Pure. Income arrives as irregular earned-wage payouts, so instead of a paycheck cadence we use the trailing
// 8 week rate, the median gap between income days, and the median income-day total as the next amount.
// deposits: positive Income-category transactions (refunds excluded by the caller). historyStart: earliest
// transaction date we have, so a short history is not diluted over 8 weeks.
export function estimateIncome(
  deposits: { date: string; amountCents: number }[],
  today: string,
  historyStart: string | null,
): IncomeRate | null {
  const from = shiftDays(today, -(INCOME_WINDOW_DAYS - 1));
  const byDay = new Map<string, number>();
  for (const d of deposits) {
    if (d.date < from || d.date > today || d.amountCents <= 0) continue;
    byDay.set(d.date, (byDay.get(d.date) ?? 0) + d.amountCents);
  }
  if (byDay.size === 0) return null;
  const days = [...byDay.keys()].sort();
  const totals = days.map((d) => byDay.get(d)!);
  const total = totals.reduce((s, v) => s + v, 0);
  const windowDays =
    historyStart === null ? INCOME_WINDOW_DAYS : Math.min(INCOME_WINDOW_DAYS, Math.max(7, daysBetween(historyStart, today) + 1));
  const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d));
  const gapDays = gaps.length ? Math.max(1, Math.round(median(gaps))) : 7;
  const lastDate = days[days.length - 1];
  const tomorrow = shiftDays(today, 1);
  const due = shiftDays(lastDate, gapDays);
  return {
    weeklyCents: Math.round((total * 7) / windowDays),
    gapDays,
    medianDepositCents: Math.round(median(totals)),
    lastDate,
    nextDate: due < tomorrow ? tomorrow : due,
    events: days.length,
  };
}

export function loadIncomeRate(db: DB, today: string): IncomeRate | null {
  const rows = db.$client
    .prepare(
      `SELECT t.date AS date, t.amount_cents AS amountCents FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE c.name = 'Income' AND t.amount_cents > 0 AND t.date >= ? AND t.date <= ?`,
    )
    .all(shiftDays(today, -(INCOME_WINDOW_DAYS - 1)), today) as { date: string; amountCents: number }[];
  const earliest = (db.$client.prepare("SELECT MIN(date) AS d FROM transactions").get() as { d: string | null }).d;
  return estimateIncome(rows, today, earliest);
}

// Future money events (bills out, income in) from today (exclusive) to toDate. Detected recurring income (a real
// paycheck cadence) wins; otherwise income follows the rate model: one deposit every gap days, median amount.
export function futureEvents(db: DB, today: string, toDate: string): Occurrence[] {
  const recurring = activeRecurring(db);
  const events = upcomingOccurrences(recurring, today, toDate);
  if (recurring.some((r) => r.avgAmountCents > 0)) return events;
  const rate = loadIncomeRate(db, today);
  if (!rate) return events;
  let d = rate.nextDate;
  let guard = 0;
  while (d <= toDate && guard++ < 400) {
    events.push({ merchantKey: "income-rate", name: "Income", date: d, amountCents: rate.medianDepositCents });
    d = shiftDays(d, rate.gapDays);
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.merchantKey.localeCompare(b.merchantKey));
}

// The next income event and how far ahead "bills before income" should look. Rate-based income can arrive every
// couple of days, so the look-ahead never drops below 7 days there (otherwise nearly nothing would count as a bill).
export function lookAhead(db: DB, today: string, fallbackEnd: string): { income: Occurrence | undefined; horizon: string } {
  const events = futureEvents(db, today, shiftDays(today, 45));
  const income = events.find((e) => e.amountCents > 0 && e.date > today);
  if (!income) return { income: undefined, horizon: fallbackEnd };
  let horizon = shiftDays(income.date, -1);
  if (income.merchantKey === "income-rate") {
    const floor = shiftDays(today, 7);
    if (horizon < floor) horizon = floor;
  }
  return { income, horizon };
}
