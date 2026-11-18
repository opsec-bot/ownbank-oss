import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { canAfford, safeToSpend } from "@/lib/finance/afford";
import { rebuildRecurring } from "@/lib/finance/recurring";
import {
  computeSuggestion,
  createSuggestionsForNew,
  isIncomeTx,
  latestSuggestion,
  updateFulfillment,
  weeklyRollup,
} from "@/lib/finance/save-plan";
import { addAccount, addTx, freshDb } from "../helpers/seed";

const NOW = Date.UTC(2025, 10, 18, 18, 0, 0); // 2025-11-18 noon Chicago

describe("isIncomeTx", () => {
  const base = { amountCents: 150000, description: "ACME PAYROLL", categoryKind: "income" as const, categoryName: "Income", recurringIncome: false };
  it("accepts paychecks and recurring income", () => {
    expect(isIncomeTx(base)).toBe(true);
    expect(isIncomeTx({ ...base, categoryKind: "expense", categoryName: "Other", recurringIncome: true })).toBe(true);
  });
  it("ignores refunds under $20, transfers and own-account moves", () => {
    expect(isIncomeTx({ ...base, amountCents: 1999 })).toBe(false);
    expect(isIncomeTx({ ...base, categoryKind: "transfer", categoryName: "Personal transfer" })).toBe(false);
    expect(isIncomeTx({ ...base, description: "Online Banking transfer from SAV 1234" })).toBe(false);
    expect(isIncomeTx({ ...base, categoryKind: "expense", categoryName: "Dining" })).toBe(false);
  });
});

describe("computeSuggestion", () => {
  const args = { depositCents: 100000, savePercent: 20, bufferCents: 5000, followingIncomeKnown: true };
  it("suggests the percentage when there is room", () => {
    expect(computeSuggestion({ ...args, lowestBeforeNextIncomeCents: 90000 })).toEqual({ suggestedCents: 20000, reason: "20% of the deposit" });
  });
  it("caps so the projected low stays above the buffer", () => {
    const s = computeSuggestion({ ...args, lowestBeforeNextIncomeCents: 15000 });
    expect(s.suggestedCents).toBe(10000);
    expect(s.reason).toMatch(/Capped/);
  });
  it("suggests nothing, with a reason, when bills leave no room", () => {
    const s = computeSuggestion({ ...args, lowestBeforeNextIncomeCents: 4000 });
    expect(s.suggestedCents).toBe(0);
    expect(s.reason).toMatch(/no room/);
  });
});

function seedPlan() {
  const db = freshDb();
  addAccount(db, "A1", { available: 120000 });
  // Monthly paycheck, monthly rent, a few discretionary spends.
  for (const d of ["2025-09-05", "2025-10-03", "2025-11-03"]) addTx(db, { date: d, amount: 100000, description: "ACME PAYROLL", payee: "Acme", category: "Income" });
  for (const d of ["2025-09-01", "2025-10-01", "2025-11-01"]) addTx(db, { date: d, amount: -50000, description: "FAKE LANDLORD", payee: "Fake Landlord", category: "Other" });
  addTx(db, { date: "2025-11-10", amount: -9000, description: "FAKE DINER", category: "Dining" });
  rebuildRecurring(db, "2025-11-18");
  return db;
}

describe("safeToSpend", () => {
  it("is checking minus bills before the next income, buffer and unmet save plan", () => {
    const db = seedPlan();
    const s = safeToSpend(db, NOW);
    // paycheck next due 2025-12-03; rent due 2025-12-01 falls before it
    expect(s.nextIncomeDate).toBe("2025-12-03");
    expect(s.nextIncomeEstCents).toBe(100000);
    expect(s.billsBeforeIncome.map((b) => b.date)).toEqual(["2025-12-01"]);
    expect(s.pendingSaveCents).toBe(0);
    expect(s.safeCents).toBe(120000 - 50000 - 5000);
  });
  it("respects a custom buffer and an unmet save suggestion", () => {
    const db = seedPlan();
    db.update(schema.settings).set({ bufferCents: 10000 }).where(eq(schema.settings.id, 1)).run();
    const id = addTx(db, { date: "2025-11-17", amount: 100000, description: "ACME PAYROLL", payee: "Acme", category: "Income" });
    db.insert(schema.saveSuggestions).values({ incomeTxId: id, suggestedCents: 20000, reason: "x", createdAt: NOW, fulfilledCents: 5000 }).run();
    const s = safeToSpend(db, NOW);
    expect(s.pendingSaveCents).toBe(15000);
    expect(s.safeCents).toBe(120000 - 50000 - 10000 - 15000);
  });
});

describe("canAfford", () => {
  it("says yes within safe-to-spend and no beyond it, with a reason", () => {
    const db = seedPlan();
    const yes = canAfford(db, 20000, undefined, NOW);
    expect(yes.ok).toBe(true);
    expect(yes.safeAfterCents).toBe(65000 - 20000);
    const no = canAfford(db, 70000, undefined, NOW);
    expect(no.ok).toBe(false);
    expect(no.reason).toMatch(/over safe to spend/);
    expect(no.safeAfterCents).toBe(-5000);
  });
  it("a future-dated purchase still counts against the projection", () => {
    const db = seedPlan();
    const r = canAfford(db, 40000, "2025-11-30", NOW);
    expect(r.projectedLowCents).toBeLessThan(120000);
    expect(typeof r.projectedLowDate).toBe("string");
  });
});

describe("save suggestions", () => {
  it("creates a suggestion for a new paycheck, caps it, and ignores old history and small refunds", () => {
    const db = seedPlan();
    const paycheck = addTx(db, { date: "2025-11-17", amount: 100000, description: "ACME PAYROLL", payee: "Acme", category: "Income" });
    const refund = addTx(db, { date: "2025-11-17", amount: 1500, description: "FAKE REFUND", category: "Income" });
    const old = addTx(db, { date: "2025-09-30", amount: 100000, description: "ACME PAYROLL", payee: "Acme", category: "Income" });
    const out = createSuggestionsForNew(db, [paycheck, refund, old], NOW);
    expect(out).toEqual([paycheck]);
    const row = db.select().from(schema.saveSuggestions).get()!;
    expect(row.suggestedCents).toBeGreaterThan(0);
    expect(row.suggestedCents).toBeLessThanOrEqual(20000);
    expect(createSuggestionsForNew(db, [paycheck], NOW)).toEqual([paycheck]); // idempotent insert
    expect(db.select().from(schema.saveSuggestions).all()).toHaveLength(1);
  });
  it("suggests 0 when bills would push checking under the buffer", () => {
    const db = freshDb();
    addAccount(db, "A1", { available: 52000 });
    for (const d of ["2025-09-05", "2025-10-03", "2025-11-03"]) addTx(db, { date: d, amount: 100000, description: "ACME PAYROLL", payee: "Acme", category: "Income" });
    for (const d of ["2025-09-01", "2025-10-01", "2025-11-01"]) addTx(db, { date: d, amount: -50000, description: "FAKE LANDLORD", payee: "Fake Landlord", category: "Other" });
    rebuildRecurring(db, "2025-11-18");
    const paycheck = addTx(db, { date: "2025-11-17", amount: 100000, description: "ACME PAYROLL", payee: "Acme", category: "Income" });
    createSuggestionsForNew(db, [paycheck], NOW);
    const row = db.select().from(schema.saveSuggestions).get()!;
    expect(row.suggestedCents).toBe(0);
    expect(row.reason).toMatch(/no room/);
  });
  it("is fulfilled by Savings transfer outflows within 5 days after the income", () => {
    const db = seedPlan();
    const paycheck = addTx(db, { date: "2025-11-17", amount: 100000, description: "ACME PAYROLL", payee: "Acme", category: "Income" });
    db.insert(schema.saveSuggestions).values({ incomeTxId: paycheck, suggestedCents: 20000, reason: "x", createdAt: NOW }).run();
    addTx(db, { date: "2025-11-18", amount: -8000, description: "COINBASE", category: "Savings transfer" });
    addTx(db, { date: "2025-11-30", amount: -99999, description: "COINBASE", category: "Savings transfer" }); // too late
    updateFulfillment(db, NOW);
    let l = latestSuggestion(db as DB)!;
    expect(l).toMatchObject({ fulfilledCents: 8000, fulfilled: false, unmetCents: 12000 });
    addTx(db, { date: "2025-11-20", amount: -12000, description: "KRAKEN", category: "Savings transfer" });
    updateFulfillment(db, NOW);
    l = latestSuggestion(db)!;
    expect(l).toMatchObject({ fulfilledCents: 20000, fulfilled: true, unmetCents: 0 });
  });
});

describe("DailyPay style income and weekly roll-up", () => {
  it("earned-wage payouts count as income, refunds never do", () => {
    const db = freshDb();
    addAccount(db, "A1", { available: 100000 });
    const pay = addTx(db, { date: "2025-11-17", amount: 15000, description: "TRANSFER DAILY PAY" });
    const refund = addTx(db, { date: "2025-11-17", amount: 1500, description: "SOME STORE RETURN" });
    expect(createSuggestionsForNew(db, [pay, refund], NOW)).toEqual([pay]);
    expect(isIncomeTx({ amountCents: 1500, description: "x", categoryKind: "income", categoryName: "Refund", recurringIncome: false })).toBe(false);
  });
  it("rolls several deposits in 7 days into one weekly suggestion", () => {
    const db = freshDb();
    addAccount(db, "A1", { available: 200000 });
    const ids = ["2025-11-12", "2025-11-14", "2025-11-16", "2025-11-17"].map((d) => addTx(db, { date: d, amount: 10000, description: "DAILYPAY INC" }));
    expect(weeklyRollup(db, "2025-11-18")?.count).toBe(4);
    createSuggestionsForNew(db, ids, NOW);
    addTx(db, { date: "2025-11-17", amount: -5000, description: "COINBASE", category: "Savings transfer" });
    const w = weeklyRollup(db, "2025-11-18")!;
    expect(w.depositCents).toBe(40000);
    expect(w.suggestedCents).toBeGreaterThan(0);
    expect(w.savedCents).toBe(5000);
  });
  it("is null with 2 or fewer deposits", () => {
    const db = freshDb();
    addAccount(db, "A1");
    addTx(db, { date: "2025-11-16", amount: 10000, description: "DAILYPAY INC" });
    addTx(db, { date: "2025-11-17", amount: 10000, description: "DAILYPAY INC" });
    expect(weeklyRollup(db, "2025-11-18")).toBeNull();
  });
});
