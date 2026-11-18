import { describe, expect, it } from "vitest";
import { detectRecurring, mergeBillingEvents, rebuildRecurring, type RecurringInput } from "@/lib/finance/recurring";
import { loadBills } from "@/lib/finance/bills";
import { schema } from "@/lib/db";
import { addAccount, addTx, freshDb } from "../helpers/seed";

const today = "2025-11-18";

function hits(
  key: string,
  rows: [string, number][],
  extra: Partial<RecurringInput> = {},
): RecurringInput[] {
  return rows.map(([date, amountCents]) => ({ merchantKey: key, date, amountCents, label: key, categoryId: null, ...extra }));
}

describe("merging same-day line items", () => {
  it("sums charges within 2 days of the first into one event", () => {
    const m = mergeBillingEvents([
      { date: "2025-10-01", amountCents: -1000 },
      { date: "2025-10-01", amountCents: -250 },
      { date: "2025-10-03", amountCents: -50 },
      { date: "2025-10-04", amountCents: -70 }, // 3 days after the first: a new event
    ]);
    expect(m.map((e) => [e.date, e.amountCents])).toEqual([
      ["2025-10-01", -1300],
      ["2025-10-04", -70],
    ]);
  });
  it("two line items billed each month are one monthly bill", () => {
    const r = detectRecurring(
      hits("host", [
        ["2025-08-14", -2000], ["2025-08-14", -500],
        ["2025-09-13", -2000], ["2025-09-13", -500],
        ["2025-10-15", -2000], ["2025-10-15", -500],
      ]),
      today,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ cadence: "monthly", avgAmountCents: -2500, occurrences: 3, variableAmount: false });
  });
});

describe("repeated multi-line bills", () => {
  it("two events that each combined 2+ same-day charges qualify", () => {
    const rows: [string, number][] = [["2025-09-14", -2000], ["2025-09-14", -500], ["2025-10-14", -2100], ["2025-10-14", -480]];
    expect(detectRecurring(hits("host", rows), today)).toHaveLength(1);
    expect(detectRecurring(hits("host", [rows[0], rows[2]]), today)).toHaveLength(0); // lone charges still need 3
  });
});

describe("variable amounts", () => {
  it("accepts any spread when every gap is within 4 days of the cadence", () => {
    const r = detectRecurring(hits("api credits", [["2025-08-10", -1500], ["2025-09-09", -4000], ["2025-10-10", -2500]]), today);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ cadence: "monthly", variableAmount: true, avgAmountCents: -2667 });
  });
  it("rejects a wide spread when the timing is loose", () => {
    const r = detectRecurring(hits("loose", [["2025-08-04", -1500], ["2025-09-12", -4000], ["2025-10-10", -2500]]), today);
    expect(r).toHaveLength(0); // gaps 39 and 28: within the 20% band but not within 4 days
  });
  it("fixed amounts stay fixed", () => {
    const r = detectRecurring(hits("sub", [["2025-08-15", -999], ["2025-09-15", -999], ["2025-10-15", -999]]), today);
    expect(r[0].variableAmount).toBe(false);
  });
});

describe("hints qualify with two events", () => {
  const two: [string, number][] = [["2025-09-20", -1200], ["2025-10-20", -1200]];
  it("needs 3 events without a hint", () => {
    expect(detectRecurring(hits("x", two), today)).toHaveLength(0);
  });
  it("accepts 2 events for a hint or the Subscriptions category", () => {
    expect(detectRecurring(hits("x", two, { hint: true }), today)).toHaveLength(1);
    expect(detectRecurring(hits("x", two, { categoryName: "Subscriptions" }), today)).toHaveLength(1);
  });
  it("still requires the single gap to fit a cadence", () => {
    expect(detectRecurring(hits("x", [["2025-09-01", -500], ["2025-10-20", -500]], { hint: true }), today)).toHaveLength(0);
  });
});

describe("excluded categories", () => {
  const monthly: [string, number][] = [["2025-08-15", -800], ["2025-09-15", -800], ["2025-10-15", -800]];
  it("never auto-detects visited merchants or transfers", () => {
    for (const name of ["Dining", "Groceries", "Transport", "Shopping", "Personal transfer", "Transfer", "Savings transfer"]) {
      expect(detectRecurring(hits("k", monthly, { categoryName: name }), today), name).toHaveLength(0);
    }
    expect(detectRecurring(hits("k", monthly, { categoryName: "Bills & Utilities" }), today)).toHaveLength(1);
  });
});

describe("rebuildRecurring", () => {
  function seed() {
    const db = freshDb();
    addAccount(db, "A1", { available: 100000 });
    // usage billed API credits, twice a month-day line items
    for (const [d, a] of [["2025-08-10", -1500], ["2025-09-09", -4000], ["2025-10-10", -2500]] as const) {
      addTx(db, { date: d, amount: a, description: "FAKE API CREDITS", payee: "Fake API", category: "Bills & Utilities" });
    }
    // fast food visited monthly: must not look recurring
    for (const d of ["2025-08-12", "2025-09-12", "2025-10-12"]) addTx(db, { date: d, amount: -900, description: "FAKE BURGER", payee: "Fake Burger", category: "Dining" });
    // paycheck, plus a refund-sized deposit that must not count
    for (const d of ["2025-08-29", "2025-09-26", "2025-10-24"]) addTx(db, { date: d, amount: 250000, description: "ACME PAYROLL", payee: "Acme", category: "Income" });
    for (const d of ["2025-08-05", "2025-09-05", "2025-10-05"]) addTx(db, { date: d, amount: 1000, description: "STORE RETURN", payee: "Store", category: "Refund" });
    // autopay hint with two events
    addTx(db, { date: "2025-09-21", amount: -3000, description: "PHONE AUTOPAY", payee: "Phone Co" });
    addTx(db, { date: "2025-10-21", amount: -3000, description: "PHONE AUTOPAY", payee: "Phone Co" });
    return db;
  }
  it("finds usage billing, hinted bills and paychecks, skips dining and refunds", () => {
    const db = seed();
    rebuildRecurring(db, today);
    const rows = db.select().from(schema.recurringCharges).all();
    const byName = Object.fromEntries(rows.map((r) => [r.displayName, r]));
    expect(Object.keys(byName).sort()).toEqual(["Acme", "Fake API", "Phone Co"]);
    expect(byName["Fake API"]).toMatchObject({ variableAmount: true, cadence: "monthly" });
    expect(byName["Acme"]).toMatchObject({ cadence: "monthly", avgAmountCents: 250000 });
    expect(byName["Phone Co"].variableAmount).toBe(false);
  });
  it("Bills shows variable items without a price-up flag", () => {
    const db = seed();
    rebuildRecurring(db, today);
    const b = loadBills(db, today);
    const api = b.items.find((i) => i.name === "Fake API")!;
    expect(api.variableAmount).toBe(true);
    expect(api.priceUp).toBe(false);
    expect(b.income.map((i) => i.name)).toEqual(["Acme"]);
  });
});
