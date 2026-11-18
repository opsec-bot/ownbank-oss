import { describe, expect, it } from "vitest";
import {
  PACE_ALERT,
  budgetAlerts,
  budgetPace,
  budgetStatus,
  fractionElapsed,
  loadBudgets,
  makeBudgetRow,
  removeBudget,
  roundLimit,
  setBudget,
  suggestLimits,
} from "@/lib/finance/budgets";
import { addAccount, addTx, catId, freshDb } from "../helpers/seed";

const row = (spent: number, limit: number, today: string) => makeBudgetRow({ categoryId: 7, name: "Dining", color: "#fff", limitCents: limit }, spent, today);

describe("pace math", () => {
  it("fraction of month elapsed counts today", () => {
    expect(fractionElapsed("2025-11-15")).toBe(0.5);
    expect(fractionElapsed("2025-11-30")).toBe(1);
    expect(fractionElapsed("2025-02-14")).toBe(0.5);
  });
  it("pace is spent over limit times fraction elapsed", () => {
    expect(budgetPace(22000, 30000, 0.5)).toBeCloseTo(1.4667, 3);
    expect(budgetPace(15000, 30000, 0.5)).toBe(1);
    expect(budgetPace(100, 0, 0.5)).toBeNull();
  });
  it("status: amber above 1.15 pace, red at the limit", () => {
    expect(budgetStatus(15000, 30000, 1)).toBe("ok");
    expect(budgetStatus(17000, 30000, 1.15)).toBe("ok"); // exactly 1.15 is not over
    expect(budgetStatus(17400, 30000, 1.16)).toBe("warn");
    expect(budgetStatus(30000, 30000, 2)).toBe("over");
    expect(budgetStatus(31000, 30000, 0.5)).toBe("over");
  });
  it("rounds limits to the nearest $10 with a $10 floor", () => {
    expect(roundLimit(23499)).toBe(23000);
    expect(roundLimit(23500)).toBe(24000);
    expect(roundLimit(120)).toBe(1000);
  });
});

describe("budget alerts", () => {
  it("fires 80% and 100% with stable keys and the documented text", () => {
    const a80 = budgetAlerts([row(24000, 30000, "2025-11-15")], "2025-11-15");
    expect(a80).toHaveLength(1);
    expect(a80[0]).toMatchObject({ level: 80, key: "budget:7:2025-11:80", body: "Dining: $240 of $300 (80%) with 50% of the month gone" });
    const a100 = budgetAlerts([row(31000, 30000, "2025-11-15")], "2025-11-15");
    expect(a100[0]).toMatchObject({ level: 100, key: "budget:7:2025-11:100" });
  });
  it("sends only the highest threshold crossed", () => {
    expect(budgetAlerts([row(35000, 30000, "2025-11-20")], "2025-11-20").map((a) => a.level)).toEqual([100]);
  });
  it("sends nothing below 80% on a normal pace", () => {
    expect(budgetAlerts([row(10000, 30000, "2025-11-15")], "2025-11-15")).toEqual([]);
  });
  it("pace warning needs day >= 10, pace > 1.25 and under 80%", () => {
    // 73% spent at 50% of the month: pace 1.47, day 15
    const hot = budgetAlerts([row(22000, 30000, "2025-11-15")], "2025-11-15");
    expect(hot).toHaveLength(1);
    expect(hot[0]).toMatchObject({ level: "pace", key: "budget:7:2025-11:pace", body: "Dining: $220 of $300 (73%) with 50% of the month gone" });
    // same ratio but day 9: no pace alert yet
    expect(budgetAlerts([row(9000, 30000, "2025-11-09")], "2025-11-09")).toEqual([]);
    // pace 1.2 at day 15: under the 1.25 line
    expect(row(18000, 30000, "2025-11-15").pace).toBeCloseTo(1.2);
    expect(PACE_ALERT).toBe(1.25);
    expect(budgetAlerts([row(18000, 30000, "2025-11-15")], "2025-11-15")).toEqual([]);
  });
  it("keys change with the month so each month alerts again", () => {
    const a = budgetAlerts([row(31000, 30000, "2025-11-15")], "2025-11-15")[0].key;
    const b = budgetAlerts([row(31000, 30000, "2025-12-15")], "2025-12-15")[0].key;
    expect(a).not.toBe(b);
  });
});

describe("budget loading", () => {
  function seed() {
    const db = freshDb();
    addAccount(db, "A1", { available: 100000 });
    // Dining: Aug-Nov history. Full months Sep, Oct, Nov-so-far.
    addTx(db, { date: "2025-08-20", amount: -1000, category: "Dining" });
    addTx(db, { date: "2025-09-10", amount: -30000, category: "Dining" });
    addTx(db, { date: "2025-10-10", amount: -20000, category: "Dining" });
    addTx(db, { date: "2025-11-05", amount: -12000, category: "Dining" });
    addTx(db, { date: "2025-11-06", amount: 2000, category: "Dining" }); // refund nets off
    addTx(db, { date: "2025-11-07", amount: -9999, category: "Savings transfer" }); // transfers never count
    return db;
  }

  it("sums month-to-date net spend per budgeted category", () => {
    const db = seed();
    setBudget(db, catId(db, "Dining"), 30000);
    const [b] = loadBudgets(db, "2025-11-15");
    expect(b).toMatchObject({ name: "Dining", spentCents: 10000, limitCents: 30000, pct: 33 });
    expect(b.status).toBe("ok");
  });

  it("set updates in place and remove deletes", () => {
    const db = seed();
    setBudget(db, catId(db, "Dining"), 30000);
    setBudget(db, catId(db, "Dining"), 25000);
    expect(loadBudgets(db, "2025-11-15")).toHaveLength(1);
    expect(loadBudgets(db, "2025-11-15")[0].limitCents).toBe(25000);
    removeBudget(db, catId(db, "Dining"));
    expect(loadBudgets(db, "2025-11-15")).toHaveLength(0);
  });

  it("suggests the average of covered full months, rounded to $10, skipping budgeted categories", () => {
    const db = seed();
    // earliest tx is 2025-08-20 so August is partial: only Sep and Oct count -> avg 25000
    const s = suggestLimits(db, "2025-11-15", "2025-08-20");
    const dining = s.find((x) => x.name === "Dining")!;
    expect(dining).toMatchObject({ avgCents: 25000, suggestedCents: 25000, months: 2 });
    setBudget(db, catId(db, "Dining"), 10000);
    expect(suggestLimits(db, "2025-11-15", "2025-08-20").find((x) => x.name === "Dining")).toBeUndefined();
  });

  it("suggests nothing without a full month of history", () => {
    const db = seed();
    expect(suggestLimits(db, "2025-11-15", "2025-11-01")).toEqual([]);
    expect(suggestLimits(db, "2025-11-15", null)).toEqual([]);
  });
});
