import { asc } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { cashFlow, earliestTxDate, tradingFlows } from "./stats";
import { addMonthsStart, monthEnd } from "./dates";
import { loadGoalProgress, type GoalProgress } from "./goal";

// Growth screen data. Everything comes from stored data: no projections, no invented history.

export type MonthKept = {
  month: string; // YYYY-MM
  inCents: number;
  outCents: number;
  keptCents: number; // money in minus money out, memecoin funding counted as out
  partial: boolean; // current month, or the first month with only part of its data
};

export type GrowthPoint = { day: string; totalCents: number };

export type Growth = {
  months: MonthKept[];
  netWorth: GrowthPoint[];
  netWorthChangeCents: number | null; // last point minus first point
  goal: GoalProgress | null;
  milestones: { pct: number; reached: boolean }[];
  keptStreak: number; // consecutive full months (newest first) with kept > 0
};

export const GROWTH_MONTHS = 4;
const MILESTONES = [25, 50, 75, 100];

export function loadGrowth(db: DB, today: string): Growth {
  const earliest = earliestTxDate(db);
  const months: MonthKept[] = [];
  if (earliest) {
    for (let i = GROWTH_MONTHS - 1; i >= 0; i--) {
      const start = addMonthsStart(today, -i);
      if (monthEnd(start) < earliest) continue;
      const end = i === 0 ? today : monthEnd(start);
      const from = start < earliest ? earliest : start;
      const flow = cashFlow(db, from, end);
      const t = tradingFlows(db, from, end);
      const outCents = flow.outCents + t.fundedCents;
      const inCents = flow.inCents + t.realizedCents;
      months.push({
        month: start.slice(0, 7),
        inCents,
        outCents,
        keptCents: inCents - outCents,
        partial: i === 0 || start < earliest,
      });
    }
  }

  const netWorth = db
    .select({ day: schema.netWorthSnapshots.day, totalCents: schema.netWorthSnapshots.totalCents })
    .from(schema.netWorthSnapshots)
    .orderBy(asc(schema.netWorthSnapshots.day))
    .all();
  const netWorthChangeCents = netWorth.length >= 2 ? netWorth[netWorth.length - 1].totalCents - netWorth[0].totalCents : null;

  const goal = loadGoalProgress(db, today);
  const milestones = MILESTONES.map((pct) => ({ pct, reached: goal ? goal.pct >= pct : false }));

  let keptStreak = 0;
  for (const m of [...months].reverse()) {
    if (m.partial) continue;
    if (m.keptCents > 0) keptStreak++;
    else break;
  }

  return { months, netWorth, netWorthChangeCents, goal, milestones, keptStreak };
}

export function monthLabel(ym: string): string {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(ym.slice(5, 7)) - 1] ?? ym;
}
