import { describe, expect, it } from "vitest";
import {
  checkingCents,
  dailyDiscretionaryCents,
  loadDailyDiscretionary,
  loadForecast,
  projectBalance,
} from "@/lib/finance/forecast";
import { rebuildRecurring } from "@/lib/finance/recurring";
import { addAccount, addTx, freshDb } from "../helpers/seed";

describe("checkingCents", () => {
  it("uses available balance of non-savings depository accounts", () => {
    expect(
      checkingCents([
        { type: "depository", name: "Fake Checking", balanceAvailableCents: 5000, balanceLedgerCents: 9000 },
        { type: "depository", name: "Fake Savings", balanceAvailableCents: 70000, balanceLedgerCents: 70000 },
        { type: "credit", name: "Fake Card", balanceAvailableCents: null, balanceLedgerCents: -3000 },
        { type: "depository", name: "Other Checking", balanceAvailableCents: null, balanceLedgerCents: 1000 },
      ]),
    ).toBe(6000);
  });
});

describe("dailyDiscretionaryCents", () => {
  it("divides by the history we have, between 14 and 60 days", () => {
    expect(dailyDiscretionaryCents(60000, "2025-09-01", "2025-11-18")).toBe(1000); // 60 day cap
    expect(dailyDiscretionaryCents(28000, "2025-11-10", "2025-11-18")).toBe(2000); // floor at 14 days
    expect(dailyDiscretionaryCents(30000, "2025-10-20", "2025-11-18")).toBe(1000); // 30 days
    expect(dailyDiscretionaryCents(100, null, "2025-11-18")).toBe(7);
  });
});

describe("projectBalance", () => {
  const base = { today: "2025-11-18", toDate: "2025-11-30", dailySpendCents: 1000 };
  it("projects the end of month balance from bills, income and daily spend", () => {
    const p = projectBalance({
      ...base,
      startCents: 50000,
      events: [
        { merchantKey: "rent", name: "Rent", date: "2025-11-20", amountCents: -20000 },
        { merchantKey: "pay", name: "Pay", date: "2025-11-25", amountCents: 100000 },
      ],
    });
    // 12 days of spend, minus rent, plus pay
    expect(p.endCents).toBe(50000 - 12000 - 20000 + 100000);
    expect(p.nextIncomeDate).toBe("2025-11-25");
    expect(p.warn).toBe(false);
    expect(p.lowestCents).toBe(23000);
    expect(p.lowestDate).toBe("2025-11-25");
  });
  it("warns when the balance dips under the threshold before the next income", () => {
    const p = projectBalance({
      ...base,
      startCents: 30000,
      events: [
        { merchantKey: "rent", name: "Rent", date: "2025-11-20", amountCents: -25000 },
        { merchantKey: "pay", name: "Pay", date: "2025-11-25", amountCents: 100000 },
      ],
    });
    expect(p.warn).toBe(true);
    expect(p.warnDate).toBe("2025-11-20");
    expect(p.lowestCents).toBeLessThan(5000);
  });
  it("does not warn when the dip happens only after the income", () => {
    const p = projectBalance({
      ...base,
      startCents: 30000,
      events: [
        { merchantKey: "pay", name: "Pay", date: "2025-11-20", amountCents: 10000 },
        { merchantKey: "rent", name: "Rent", date: "2025-11-28", amountCents: -60000 },
      ],
    });
    expect(p.warn).toBe(false);
    expect(p.lowestCents).toBeLessThan(0);
  });
  it("with no income known, any dip in the month warns", () => {
    const p = projectBalance({
      ...base,
      startCents: 20000,
      events: [{ merchantKey: "rent", name: "Rent", date: "2025-11-28", amountCents: -20000 }],
    });
    expect(p.nextIncomeDate).toBeNull();
    expect(p.warn).toBe(true);
  });
  it("on the last day of the month there is nothing left to project", () => {
    const p = projectBalance({ today: "2025-11-30", toDate: "2025-11-30", startCents: 1234, events: [], dailySpendCents: 999 });
    expect(p).toMatchObject({ endCents: 1234, lowestCents: 1234, warn: false });
  });
});

describe("loadForecast", () => {
  it("excludes recurring merchants, transfers and income from the daily spend", () => {
    const db = freshDb();
    addAccount(db, "A1", { available: 100000 });
    for (const d of ["2025-09-05", "2025-10-05", "2025-11-05"]) addTx(db, { date: d, amount: -1000, description: "NETFLIX.COM", payee: "Netflix" });
    addTx(db, { date: "2025-11-10", amount: -6000, description: "FAKE DINER", category: "Dining" });
    addTx(db, { date: "2025-11-11", amount: -50000, description: "ZELLE TO SOMEONE" }); // personal transfer: not spend
    addTx(db, { date: "2025-11-12", amount: 90000, description: "ACME", category: "Refund" }); // not Income: no income model events
    rebuildRecurring(db, "2025-11-18");
    // earliest tx 2025-09-05 -> 60 day span; 6000 / 60 = 100
    expect(loadDailyDiscretionary(db, "2025-11-18")).toBe(100);
    const f = loadForecast(db, "2025-11-18");
    expect(f.startCents).toBe(100000);
    // netflix due 2025-12-05 is outside November, so only daily spend applies: 12 days * 100
    expect(f.endCents).toBe(100000 - 1200);
  });
});
