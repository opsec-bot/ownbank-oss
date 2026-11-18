import { describe, expect, it } from "vitest";
import { schema } from "@/lib/db";
import { getGoal, goalMath, goalPerDepositCents, highestMilestone, loadGoalProgress, perDeposit } from "@/lib/finance/goal";
import { computeSuggestion } from "@/lib/finance/save-plan";
import { addAccount, addTx, freshDb } from "../helpers/seed";

const TODAY = "2025-11-18";

describe("goalMath", () => {
  const base = { targetCents: 100000, trailing4wCents: 0, today: TODAY };
  it("progress, to go and no-date status", () => {
    const m = goalMath({ ...base, targetDate: null, currentCents: 25000 });
    expect(m).toMatchObject({ pct: 25, toGoCents: 75000, reached: false, status: "no_date", requiredPerWeekCents: null });
  });
  it("required pace vs trailing 4 week pace: on track", () => {
    // 10 weeks (70 days) left, $700 to go -> $70/week. Saved $400 in 4 weeks = $100/week.
    const m = goalMath({ ...base, targetDate: "2026-01-27", currentCents: 30000, trailing4wCents: 40000 });
    expect(m.weeksLeft).toBe(10);
    expect(m.requiredPerWeekCents).toBe(70000 / 10);
    expect(m.actualPerWeekCents).toBe(10000);
    expect(m.status).toBe("on_track");
  });
  it("behind reports the weekly gap", () => {
    const m = goalMath({ ...base, targetDate: "2026-01-27", currentCents: 30000, trailing4wCents: 8000 });
    expect(m.requiredPerWeekCents).toBe(7000);
    expect(m.actualPerWeekCents).toBe(2000);
    expect(m).toMatchObject({ status: "behind", behindPerWeekCents: 5000 });
  });
  it("reached beats everything; a passed date with money left is past due", () => {
    expect(goalMath({ ...base, targetDate: "2026-01-27", currentCents: 100000 })).toMatchObject({ status: "reached", toGoCents: 0, pct: 100 });
    expect(goalMath({ ...base, targetDate: "2025-11-01", currentCents: 50000 })).toMatchObject({ status: "past_due", requiredPerWeekCents: 50000 });
  });
  it("milestones", () => {
    expect(highestMilestone(24)).toBe(0);
    expect(highestMilestone(25)).toBe(25);
    expect(highestMilestone(74)).toBe(50);
    expect(highestMilestone(120)).toBe(100);
  });
});

function goalDb() {
  const db = freshDb();
  addAccount(db, "A1", { available: 200000 });
  db.insert(schema.cryptoWallets)
    .values([
      { address: "SAVINGS1111111111111111111111111111111111111", role: "savings", stableUsdCents: 30000, volatileUsdCents: 10000, totalUsdCents: 40000 },
      { address: "TRADING1111111111111111111111111111111111111", role: "trading", stableUsdCents: 999999, volatileUsdCents: 999999, totalUsdCents: 1999998 },
    ])
    .run();
  return db;
}

describe("goal progress from wallets", () => {
  it("counts savings-wallet stable only (default) and never trading wallets", () => {
    const db = goalDb();
    db.insert(schema.savingsGoal).values({ id: 1, name: "Car", targetCents: 100000, createdAt: 1 }).run();
    expect(loadGoalProgress(db, TODAY)).toMatchObject({ currentCents: 30000, pct: 30 });
  });
  it("all_savings adds volatile, still excluding trading", () => {
    const db = goalDb();
    db.insert(schema.savingsGoal).values({ id: 1, name: "Car", targetCents: 100000, counts: "all_savings", createdAt: 1 }).run();
    expect(loadGoalProgress(db, TODAY)).toMatchObject({ currentCents: 40000, pct: 40 });
  });
  it("trailing pace comes from savings transfers in the last 28 days", () => {
    const db = goalDb();
    db.insert(schema.savingsGoal).values({ id: 1, name: "Car", targetCents: 100000, targetDate: "2026-01-27", createdAt: 1 }).run();
    addTx(db, { date: "2025-11-10", amount: -20000, category: "Savings transfer" });
    addTx(db, { date: "2025-10-25", amount: -20000, category: "Savings transfer" }); // 24 days back: inside
    addTx(db, { date: "2025-10-01", amount: -50000, category: "Savings transfer" }); // outside
    expect(loadGoalProgress(db, TODAY)!.actualPerWeekCents).toBe(10000);
  });
  it("no goal row means no progress", () => {
    expect(loadGoalProgress(goalDb(), TODAY)).toBeNull();
    expect(getGoal(goalDb())).toBeNull();
  });
});

describe("save plan with a goal", () => {
  const args = { depositCents: 100000, savePercent: 20, bufferCents: 5000, followingIncomeKnown: true, lowestBeforeNextIncomeCents: 500000 };
  it("takes the larger of the percent rule and the goal pace", () => {
    const s = computeSuggestion({ ...args, goalPerDepositCents: 35000, goalName: "Car" });
    expect(s.suggestedCents).toBe(35000);
    expect(s.reason).toMatch(/goal "Car"/);
    expect(computeSuggestion({ ...args, goalPerDepositCents: 5000 })).toEqual({ suggestedCents: 20000, reason: "20% of the deposit" });
  });
  it("a goal still saves when the percent is 0", () => {
    expect(computeSuggestion({ ...args, savePercent: 0, goalPerDepositCents: 15000 }).suggestedCents).toBe(15000);
    expect(computeSuggestion({ ...args, savePercent: 0 }).suggestedCents).toBe(0);
  });
  it("is still capped by the bills + buffer safety rule", () => {
    const s = computeSuggestion({ ...args, lowestBeforeNextIncomeCents: 25000, goalPerDepositCents: 50000 });
    expect(s.suggestedCents).toBe(20000); // 25000 low - 5000 buffer
    expect(s.reason).toMatch(/Capped/);
    expect(computeSuggestion({ ...args, lowestBeforeNextIncomeCents: 3000, goalPerDepositCents: 50000 }).suggestedCents).toBe(0);
  });
  it("per-deposit amount divides the weekly need by expected deposits", () => {
    expect(perDeposit(10000, 4)).toBe(2500);
    expect(perDeposit(10001, 4)).toBe(2501);
    expect(perDeposit(0, 4)).toBe(0);
  });
  it("goalPerDepositCents needs a dated, unmet goal", () => {
    const db = goalDb();
    expect(goalPerDepositCents(db, TODAY)).toBeNull();
    db.insert(schema.savingsGoal).values({ id: 1, name: "Car", targetCents: 100000, createdAt: 1 }).run();
    expect(goalPerDepositCents(db, TODAY)).toBeNull(); // no date
    db.update(schema.savingsGoal).set({ targetDate: "2026-01-27" }).run();
    // $700 to go over 10 weeks = $70/week; no income history -> 1 deposit/week
    expect(goalPerDepositCents(db, TODAY)).toEqual({ cents: 7000, goalName: "Car" });
    db.update(schema.savingsGoal).set({ targetCents: 20000 }).run(); // already reached
    expect(goalPerDepositCents(db, TODAY)).toBeNull();
  });
});
