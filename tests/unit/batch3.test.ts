import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { merchantKey } from "@/lib/bank/normalize";
import { schema } from "@/lib/db";
import { canAfford, safeToSpend } from "@/lib/finance/afford";
import { estimateIncome, futureEvents, loadIncomeRate } from "@/lib/finance/income";
import { rekeyAll, runPendingTasks } from "@/lib/finance/recategorize";
import { categoryBreakdown, merchantBreakdown, periods } from "@/lib/finance/spending";
import { parseFilters, queryTransactions } from "@/lib/finance/tx-query";
import { addAccount, addTx, freshDb } from "../helpers/seed";

describe("merchantKey brand tokens and trailing city/state", () => {
  it("keeps 7-11 and drops the city and state", () => {
    expect(merchantKey(null, "7-11 #10452 DALLAS TX")).toBe("7-11");
    expect(merchantKey(null, "7-ELEVEN 10452 DALLAS TX")).toBe("7-eleven"); // store numbers are still dropped
    expect(merchantKey(null, "FAKE GROCERY #123 DALLAS TX")).toBe("fake grocery");
    expect(merchantKey(null, "CHICK-FIL-A #02214 FLOWER MOUND TX")).toBe("chickfila");
    expect(merchantKey(null, "FAKE CAFE THE COLONY TX")).toBe("fake cafe");
  });
  it("only drops a city when a state follows and something else remains", () => {
    expect(merchantKey(null, "DALLAS TX")).toBe("dallas");
    expect(merchantKey(null, "DALLAS MORNING NEWS")).toBe("dallas morning news");
    expect(merchantKey(null, "FAKE SHOP DALLAS")).toBe("fake shop dallas");
    expect(merchantKey(null, "Fake Shop in")).toBe("fake shop in"); // mixed case "in" is a word, not a state
  });
  it("does not touch other bank text", () => {
    expect(merchantKey(null, "AMZN Mktp US*2K4AB  Amzn.com/bill")).toBe("amzn mktp us amzncom bill");
  });
});

describe("rekeyAll", () => {
  it("recomputes merchant keys, keeps categories, moves ignored recurring rows", () => {
    const db = freshDb();
    addAccount(db, "A1");
    const t = addTx(db, { date: "2025-11-01", amount: -500, description: "7-11 #1 DALLAS TX", category: "Transport", source: "manual" });
    db.update(schema.transactions).set({ merchantKey: "dallas" }).where(eq(schema.transactions.id, t)).run();
    db.insert(schema.recurringCharges)
      .values({ merchantKey: "dallas", displayName: "x", cadence: "monthly", avgAmountCents: -500, lastDate: "2025-11-01", nextExpected: "2025-12-01", occurrences: 3, ignored: true })
      .run();
    expect(rekeyAll(db)).toEqual({ checked: 1, changed: 1 });
    const row = db.select().from(schema.transactions).get()!;
    expect(row).toMatchObject({ merchantKey: "7-11", categorySource: "manual" });
    expect(db.select().from(schema.recurringCharges).get()?.merchantKey).toBe("7-11");
    expect(rekeyAll(db).changed).toBe(0);
  });
  it("runs once as a pending task", () => {
    const db = freshDb();
    expect(runPendingTasks(db)).toContain("rekey");
    expect(runPendingTasks(db)).not.toContain("rekey");
  });
});

describe("income rate", () => {
  const today = "2025-11-18";
  it("uses the trailing 8 week average, median gap and median deposit", () => {
    const deposits = [
      { date: "2025-11-17", amountCents: 12000 },
      { date: "2025-11-14", amountCents: 8000 },
      { date: "2025-11-14", amountCents: 4000 }, // same day: one 12000 event
      { date: "2025-11-10", amountCents: 6000 },
      { date: "2025-11-07", amountCents: 12000 },
      { date: "2025-09-01", amountCents: 999999 }, // outside the window
    ];
    const r = estimateIncome(deposits, today, "2025-08-01")!;
    expect(r.events).toBe(4);
    expect(r.weeklyCents).toBe(Math.round((42000 * 7) / 56));
    expect(r.gapDays).toBe(3); // gaps 3, 4, 3
    expect(r.medianDepositCents).toBe(12000);
    expect(r.lastDate).toBe("2025-11-17");
    expect(r.nextDate).toBe("2025-11-20");
  });
  it("short history is not diluted, and an overdue next date moves to tomorrow", () => {
    const r = estimateIncome([{ date: "2025-11-01", amountCents: 7000 }, { date: "2025-11-04", amountCents: 7000 }], today, "2025-11-01")!;
    expect(r.weeklyCents).toBe(Math.round((14000 * 7) / 18));
    expect(r.nextDate).toBe("2025-11-19");
  });
  it("is null with no income and ignores refunds (only the Income category counts)", () => {
    expect(estimateIncome([], today, null)).toBeNull();
    const db = freshDb();
    addAccount(db, "A1");
    addTx(db, { date: "2025-11-15", amount: 5000, description: "STORE RETURN", category: "Refund" });
    expect(loadIncomeRate(db, today)).toBeNull();
    addTx(db, { date: "2025-11-16", amount: 9000, description: "DAILYPAY", category: "Income" });
    expect(loadIncomeRate(db, today)?.medianDepositCents).toBe(9000);
  });
  it("feeds the forecast, safe-to-spend and can-afford when there is no recurring income", () => {
    const db = freshDb();
    addAccount(db, "A1", { available: 50000 });
    for (const d of ["2025-11-04", "2025-11-07", "2025-11-10", "2025-11-13", "2025-11-16"]) addTx(db, { date: d, amount: 10000, description: "DAILYPAY INC", category: "Income" });
    const now = Date.UTC(2025, 10, 18, 18, 0, 0);
    const ev = futureEvents(db, today, "2025-11-30");
    expect(ev.filter((e) => e.merchantKey === "income-rate").map((e) => e.date).slice(0, 3)).toEqual(["2025-11-19", "2025-11-22", "2025-11-25"]);
    const s = safeToSpend(db, now);
    expect(s.nextIncomeDate).toBe("2025-11-19");
    expect(s.nextIncomeEstCents).toBe(10000);
    expect(canAfford(db, 1000, undefined, now).ok).toBe(true);
  });
  it("detected recurring income still wins over the rate model", () => {
    const db = freshDb();
    addAccount(db, "A1");
    addTx(db, { date: "2025-11-16", amount: 9000, description: "DAILYPAY", category: "Income" });
    db.insert(schema.recurringCharges)
      .values({ merchantKey: "acme", displayName: "Acme", cadence: "monthly", avgAmountCents: 300000, lastDate: "2025-11-14", nextExpected: "2025-12-14", occurrences: 3 })
      .run();
    const inc = futureEvents(db, today, "2025-12-31").filter((e) => e.amountCents > 0);
    expect(inc.map((e) => e.merchantKey)).toEqual(["acme"]);
  });
});

describe("spending breakdown", () => {
  const today = "2025-11-18";
  function seed() {
    const db = freshDb();
    addAccount(db, "A1");
    addTx(db, { date: "2025-08-30", amount: -100, description: "OLD", category: "Other" }); // history starts Aug 30
    // Dining across months
    addTx(db, { date: "2025-09-05", amount: -2000, description: "FAKE DINER 1", category: "Dining" });
    addTx(db, { date: "2025-10-05", amount: -3000, description: "FAKE DINER 2", category: "Dining" });
    addTx(db, { date: "2025-10-25", amount: -4000, description: "FAKE DINER 3", category: "Dining" }); // after the 18th
    addTx(db, { date: "2025-11-05", amount: -6000, description: "FAKE DINER 4", category: "Dining" });
    addTx(db, { date: "2025-11-10", amount: -1000, description: "FAKE BAKERY", category: "Dining" });
    addTx(db, { date: "2025-11-11", amount: -9000, description: "FAKE MARKET", category: "Groceries" });
    addTx(db, { date: "2025-11-12", amount: -50000, description: "COINBASE", category: "Savings transfer" }); // excluded
    addTx(db, { date: "2025-11-13", amount: 80000, description: "PAY", category: "Income" }); // excluded
    return db;
  }
  it("compares the month with last month (same point and full) and the 3-month average", () => {
    const db = seed();
    const p = periods("2025-11-01", today, "2025-08-30");
    expect(p.point).toBe(today);
    expect(p.prior.map((x) => x.from)).toEqual(["2025-10-01", "2025-09-01"]); // August starts before our history
    const rows = categoryBreakdown(db, p);
    expect(rows.map((r) => r.name)).toEqual(["Groceries", "Dining"]);
    const dining = rows.find((r) => r.name === "Dining")!;
    expect(dining.cents).toBe(7000);
    expect(dining.lastSameCents).toBe(3000);
    expect(dining.lastFullCents).toBe(7000);
    expect(dining.avg3Cents).toBe(Math.round((3000 + 2000) / 2)); // Oct and Sep up to the 18th
    expect(dining.pctVsAvg).toBe(Math.round(((7000 - 2500) / 2500) * 100));
    expect(rows.some((r) => r.name === "Savings transfer" || r.name === "Income")).toBe(false);
  });
  it("a past month is measured in full", () => {
    const db = seed();
    const p = periods("2025-10-01", today, "2025-08-30");
    expect(p.point).toBe("2025-10-31");
    const dining = categoryBreakdown(db, p).find((r) => r.name === "Dining")!;
    expect(dining.cents).toBe(7000);
    expect(dining.lastFullCents).toBe(2000);
  });
  it("lists merchants for a category with count, total, average ticket and comparisons", () => {
    const db = seed();
    const p = periods("2025-11-01", today, "2025-08-30");
    const dining = categoryBreakdown(db, p).find((r) => r.name === "Dining")!;
    const m = merchantBreakdown(db, p, dining.key);
    expect(m.map((x) => [x.merchantKey, x.count, x.cents, x.avgTicketCents])).toEqual([
      ["fake diner", 1, 6000, 6000],
      ["fake bakery", 1, 1000, 1000],
    ]);
    const top = merchantBreakdown(db, p, null, 1);
    expect(top).toHaveLength(1);
    expect(top[0].merchantKey).toBe("fake market");
  });
  it("includes trading wallet funding as its own row", () => {
    const db = seed();
    db.insert(schema.walletFlows).values({ signature: "s", day: "2025-11-04", fromAddress: "a", toAddress: "b", mint: "SOL", symbol: "SOL", amountRaw: "1", usdCents: 20000, kind: "trading_funded" }).run();
    const rows = categoryBreakdown(db, periods("2025-11-01", today, "2025-08-30"));
    expect(rows[0]).toMatchObject({ key: "trading", name: "Memecoin trading", cents: 20000 });
  });
});

describe("merchant filter on transactions", () => {
  it("filters by exact merchant key", () => {
    const db = freshDb();
    addAccount(db, "A1");
    addTx(db, { date: "2025-11-01", amount: -500, description: "FAKE DINER 1" });
    addTx(db, { date: "2025-11-02", amount: -500, description: "FAKE DINER 2" });
    addTx(db, { date: "2025-11-03", amount: -500, description: "OTHER PLACE" });
    const f = parseFilters({ mk: "fake diner" });
    expect(f.merchant).toBe("fake diner");
    expect(queryTransactions(db, f, 1).total).toBe(2);
  });
});
