import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { billFlags, effectiveNext, loadBills, monthlyEquivalentCents, upcomingOccurrences } from "@/lib/finance/bills";
import { rebuildRecurring } from "@/lib/finance/recurring";
import { addAccount, addTx, freshDb } from "../helpers/seed";

describe("monthlyEquivalentCents", () => {
  it("normalizes every cadence to a month", () => {
    expect(monthlyEquivalentCents(-1200, "monthly")).toBe(-1200);
    expect(monthlyEquivalentCents(-1200, "yearly")).toBe(-100);
    expect(monthlyEquivalentCents(-1200, "weekly")).toBe(-5200);
    expect(monthlyEquivalentCents(-1200, "biweekly")).toBe(-2600);
  });
});

describe("billFlags", () => {
  it("flags a price rise above 5% against earlier occurrences", () => {
    expect(billFlags([-1000, -1000, -1100], "2025-01-01", "2025-11-18")).toMatchObject({ priceUp: true, priceUpPct: 10 });
    expect(billFlags([-1000, -1000, -1050], "2025-01-01", "2025-11-18").priceUp).toBe(false); // exactly 5% is not over
    expect(billFlags([-1000, -1000, -900], "2025-01-01", "2025-11-18").priceUp).toBe(false);
    expect(billFlags([-1000], "2025-01-01", "2025-11-18").priceUp).toBe(false);
  });
  it("flags charges first seen in the last 30 days as new", () => {
    expect(billFlags([-500], "2025-11-01", "2025-11-18").isNew).toBe(true);
    expect(billFlags([-500], "2025-10-01", "2025-11-18").isNew).toBe(false);
    expect(billFlags([-500], null, "2025-11-18").isNew).toBe(false);
  });
});

describe("effectiveNext / upcomingOccurrences", () => {
  it("keeps future dates, treats slightly late charges as due tomorrow, rolls old ones forward", () => {
    expect(effectiveNext({ nextExpected: "2025-11-25", cadence: "monthly" }, "2025-11-18")).toBe("2025-11-25");
    expect(effectiveNext({ nextExpected: "2025-11-16", cadence: "monthly" }, "2025-11-18")).toBe("2025-11-19");
    expect(effectiveNext({ nextExpected: "2025-10-01", cadence: "monthly" }, "2025-11-18")).toBe("2025-12-01");
    expect(effectiveNext({ nextExpected: null, cadence: "monthly" }, "2025-11-18")).toBeNull();
  });
  it("lists repeating occurrences inside the window in date order", () => {
    const rows = [
      { merchantKey: "a", displayName: "A", cadence: "weekly" as const, avgAmountCents: -100, nextExpected: "2025-11-20" },
      { merchantKey: "b", displayName: "B", cadence: "monthly" as const, avgAmountCents: -500, nextExpected: "2025-11-19" },
    ];
    const o = upcomingOccurrences(rows, "2025-11-18", "2025-12-04");
    expect(o.map((x) => `${x.merchantKey}${x.date.slice(5)}`)).toEqual(["b11-19", "a11-20", "a11-27", "a12-04"]);
  });
});

describe("loadBills", () => {
  function seed() {
    const db = freshDb();
    addAccount(db, "A1", { available: 100000 });
    // Netflix-like subscription: 3 monthly charges, last one 10% higher.
    addTx(db, { date: "2025-09-05", amount: -1000, description: "NETFLIX.COM", payee: "Netflix" });
    addTx(db, { date: "2025-10-05", amount: -1000, description: "NETFLIX.COM", payee: "Netflix" });
    addTx(db, { date: "2025-11-05", amount: -1100, description: "NETFLIX.COM", payee: "Netflix" });
    // A weekly gym that began recently.
    addTx(db, { date: "2025-11-04", amount: -1500, description: "FAKE GYM", payee: "Fake Gym", category: "Health" });
    addTx(db, { date: "2025-11-11", amount: -1500, description: "FAKE GYM", payee: "Fake Gym", category: "Health" });
    addTx(db, { date: "2025-11-18", amount: -1500, description: "FAKE GYM", payee: "Fake Gym", category: "Health" });
    // Monthly paycheck.
    for (const d of ["2025-09-15", "2025-10-15", "2025-11-14"]) addTx(db, { date: d, amount: 200000, description: "ACME PAYROLL", payee: "Acme" });
    rebuildRecurring(db, "2025-11-18");
    return db;
  }

  it("totals recurring outflows per month and sorts by next date", () => {
    const b = loadBills(seed(), "2025-11-18");
    expect(b.items.map((i) => i.name)).toEqual(["Fake Gym", "Netflix"]);
    // gym 1500 * 52 / 12 = 6500, netflix 1033 average -> about 1033
    expect(b.monthlyTotalCents).toBe(6500 + 1033);
    expect(b.income).toHaveLength(1);
    expect(b.items[0]).toMatchObject({ cadence: "weekly", isNew: true, nextDate: "2025-11-25", daysUntil: 7 });
    expect(b.items[1]).toMatchObject({ priceUp: true, priceUpPct: 10, isSubscription: true, isNew: false });
    expect(b.dueSoon.map((i) => i.name)).toEqual(["Fake Gym"]);
  });

  it("ignored items drop out of totals and survive a rebuild", () => {
    const db = seed();
    db.update(schema.recurringCharges).set({ ignored: true }).where(eq(schema.recurringCharges.merchantKey, "netflix")).run();
    rebuildRecurring(db, "2025-11-18");
    const b = loadBills(db, "2025-11-18");
    expect(b.items.map((i) => i.name)).toEqual(["Fake Gym"]);
    expect(b.ignored.map((i) => i.name)).toEqual(["Netflix"]);
    expect(b.monthlyTotalCents).toBe(6500);
  });

  it("manual items are kept through rebuilds and count in totals", () => {
    const db = seed();
    db.insert(schema.recurringCharges)
      .values({ merchantKey: "manual:rent", displayName: "Rent", cadence: "monthly", avgAmountCents: -90000, lastDate: "2025-11-01", nextExpected: "2025-12-01", occurrences: 0, manual: true })
      .run();
    rebuildRecurring(db, "2025-11-18");
    const b = loadBills(db, "2025-11-18");
    expect(b.items.some((i) => i.name === "Rent" && i.manual && !i.isNew && !i.priceUp)).toBe(true);
    expect(b.monthlyTotalCents).toBe(6500 + 1033 + 90000);
  });
});
