import { eq } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { daysBetween, shiftDays } from "./dates";
import { loadIncomeRate } from "./income";
import { cryptoSplit } from "./networth";
import { savingsTransfers } from "./stats";

// One savings goal. Progress counts savings wallets only (trading wallets never count).

export const MILESTONES = [100, 75, 50, 25] as const; // percent, highest first
export const PACE_WINDOW_DAYS = 28;

export type Goal = typeof schema.savingsGoal.$inferSelect;

export type GoalProgress = {
  name: string;
  targetCents: number;
  targetDate: string | null;
  counts: "stable" | "all_savings";
  currentCents: number;
  pct: number; // whole percent, can pass 100
  toGoCents: number;
  reached: boolean;
  // Only when a target date exists:
  weeksLeft: number | null;
  requiredPerWeekCents: number | null;
  actualPerWeekCents: number; // trailing 4 week savings transfers / 4
  status: "no_date" | "on_track" | "behind" | "past_due" | "reached";
  behindPerWeekCents: number; // > 0 only when behind
};

// Pure.
export function goalMath(args: {
  targetCents: number;
  targetDate: string | null;
  currentCents: number;
  trailing4wCents: number;
  today: string;
}): Omit<GoalProgress, "name" | "counts" | "targetCents" | "targetDate" | "currentCents"> {
  const { targetCents, targetDate, currentCents, trailing4wCents, today } = args;
  const toGo = Math.max(0, targetCents - currentCents);
  const reached = currentCents >= targetCents;
  const actualPerWeek = Math.round(trailing4wCents / 4);
  const pct = targetCents > 0 ? Math.floor((currentCents / targetCents) * 100) : 0;
  const base = { pct, toGoCents: toGo, reached, actualPerWeekCents: actualPerWeek };
  if (reached) {
    return { ...base, weeksLeft: null, requiredPerWeekCents: null, status: "reached", behindPerWeekCents: 0 };
  }
  if (!targetDate) {
    return { ...base, weeksLeft: null, requiredPerWeekCents: null, status: "no_date", behindPerWeekCents: 0 };
  }
  const days = daysBetween(today, targetDate);
  if (days <= 0) {
    return { ...base, weeksLeft: 0, requiredPerWeekCents: toGo, status: "past_due", behindPerWeekCents: 0 };
  }
  const weeks = Math.max(days / 7, 1 / 7);
  const required = Math.ceil(toGo / weeks);
  const behind = Math.max(0, required - actualPerWeek);
  return {
    ...base,
    weeksLeft: weeks,
    requiredPerWeekCents: required,
    status: behind > 0 ? "behind" : "on_track",
    behindPerWeekCents: behind,
  };
}

export function getGoal(db: DB): Goal | null {
  return db.select().from(schema.savingsGoal).where(eq(schema.savingsGoal.id, 1)).get() ?? null;
}

// Savings wallets only. "stable" = stablecoins; "all_savings" = stable + volatile.
export function savedCents(db: DB, counts: "stable" | "all_savings"): number {
  const s = cryptoSplit(db.select().from(schema.cryptoWallets).all());
  return counts === "all_savings" ? s.stableCents + s.volatileCents : s.stableCents;
}

export function loadGoalProgress(db: DB, today: string): GoalProgress | null {
  const g = getGoal(db);
  if (!g) return null;
  const current = savedCents(db, g.counts);
  const from = shiftDays(today, -(PACE_WINDOW_DAYS - 1));
  const trailing = savingsTransfers(db, from, today).cents;
  const m = goalMath({ targetCents: g.targetCents, targetDate: g.targetDate, currentCents: current, trailing4wCents: trailing, today });
  return { name: g.name, targetCents: g.targetCents, targetDate: g.targetDate, counts: g.counts, currentCents: current, ...m };
}

// Highest milestone (25/50/75/100) reached, or 0.
export function highestMilestone(pct: number): number {
  return MILESTONES.find((m) => pct >= m) ?? 0;
}

// Extra save needed per deposit to hit the goal date, or 0 when there is no dated, unmet goal. Deposits per week come
// from the trailing income rate (falls back to 1 per week).
export function goalPerDepositCents(db: DB, today: string): { cents: number; goalName: string } | null {
  const g = getGoal(db);
  if (!g || !g.targetDate) return null;
  const p = loadGoalProgress(db, today);
  if (!p || p.requiredPerWeekCents === null || p.reached) return null;
  const rate = loadIncomeRate(db, today);
  const perWeek = rate && rate.medianDepositCents > 0 ? Math.max(0.25, rate.weeklyCents / rate.medianDepositCents) : 1;
  return { cents: perDeposit(p.requiredPerWeekCents, perWeek), goalName: g.name };
}

// Pure.
export function perDeposit(requiredPerWeekCents: number, depositsPerWeek: number): number {
  if (requiredPerWeekCents <= 0 || depositsPerWeek <= 0) return 0;
  return Math.ceil(requiredPerWeekCents / depositsPerWeek);
}
