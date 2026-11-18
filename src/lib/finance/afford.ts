import { eq } from "drizzle-orm";
import { localDate } from "@/lib/bank/normalize";
import { schema, type DB } from "@/lib/db";
import type { Occurrence } from "./bills";
import { futureEvents, lookAhead } from "./income";
import { daysBetween, monthEnd } from "./dates";
import { checkingCents, loadDailyDiscretionary, projectBalance } from "./forecast";
import { formatCents } from "./networth";
import { latestSuggestion } from "./save-plan";

export type SafeToSpend = {
  safeCents: number; // can be negative
  checkingCents: number;
  nextIncomeDate: string | null;
  nextIncomeEstCents: number | null;
  billsBeforeIncome: Occurrence[];
  bufferCents: number;
  pendingSaveCents: number;
};

function context(db: DB, now: number) {
  const today = localDate(Math.floor(now / 1000));
  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get();
  // Bills count up to the day before the income lands. Without a known income, look to the end of the month.
  const { income, horizon } = lookAhead(db, today, monthEnd(today));
  return {
    today,
    bufferCents: settings?.bufferCents ?? 5000,
    income,
    horizon,
    bills: futureEvents(db, today, horizon).filter((e) => e.amountCents < 0),
    checking: checkingCents(db.select().from(schema.accounts).all()),
    pendingSave: latestSuggestion(db)?.unmetCents ?? 0,
  };
}

export function safeToSpend(db: DB, now = Date.now()): SafeToSpend {
  const c = context(db, now);
  const billsTotal = c.bills.reduce((s, b) => s - b.amountCents, 0);
  return {
    safeCents: c.checking - billsTotal - c.bufferCents - c.pendingSave,
    checkingCents: c.checking,
    nextIncomeDate: c.income?.date ?? null,
    nextIncomeEstCents: c.income?.amountCents ?? null,
    billsBeforeIncome: c.bills,
    bufferCents: c.bufferCents,
    pendingSaveCents: c.pendingSave,
  };
}

export type CanAfford = {
  ok: boolean;
  safeAfterCents: number;
  projectedLowCents: number;
  projectedLowDate: string;
  reason: string;
};

// Would spending amountCents (positive) on onDate (default today) break safe-to-spend or overdraw the account?
export function canAfford(db: DB, amountCents: number, onDate?: string, now = Date.now()): CanAfford {
  const c = context(db, now);
  const spendDate = onDate && onDate > c.today ? onDate : c.today;
  const safe = safeToSpend(db, now);
  const toDate = spendDate > c.horizon ? spendDate : c.horizon;
  const events: Occurrence[] = futureEvents(db, c.today, toDate);
  if (spendDate > c.today) {
    events.push({ merchantKey: "purchase", name: "purchase", date: spendDate, amountCents: -amountCents });
  }
  const p = projectBalance({
    startCents: c.checking - (spendDate === c.today ? amountCents : 0),
    today: c.today,
    toDate,
    events,
    dailySpendCents: loadDailyDiscretionary(db, c.today),
  });
  const safeAfter = safe.safeCents - amountCents;
  const ok = safeAfter >= 0 && p.lowestCents >= 0;
  let reason: string;
  if (ok) reason = `Leaves ${formatCents(safeAfter)} safe to spend`;
  else if (safeAfter < 0) {
    reason = `${formatCents(-safeAfter)} over safe to spend (${formatCents(safe.safeCents)} after bills, buffer and planned savings)`;
  } else {
    reason = `Projected to overdraw by ${formatCents(-p.lowestCents)} on ${p.lowestDate}, ${daysBetween(c.today, p.lowestDate)} days out`;
  }
  return { ok, safeAfterCents: safeAfter, projectedLowCents: p.lowestCents, projectedLowDate: p.lowestDate, reason };
}
