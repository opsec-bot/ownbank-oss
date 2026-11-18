import { describe, expect, it } from "vitest";
import { schema } from "@/lib/db";
import { loadGrowth } from "@/lib/finance/growth";
import { addAccount, addTx, freshDb } from "../helpers/seed";

describe("loadGrowth", () => {
  it("computes kept per month, partial months and the streak", () => {
    const db = freshDb();
    addAccount(db, "A1", { available: 10000 });
    addTx(db, { date: "2025-08-20", amount: 50000, category: "Income" }); // first month starts mid-month: partial
    addTx(db, { date: "2025-09-05", amount: 100000, category: "Income" });
    addTx(db, { date: "2025-09-10", amount: -30000, category: "Dining" });
    addTx(db, { date: "2025-10-05", amount: 80000, category: "Income" });
    addTx(db, { date: "2025-10-12", amount: -20000, category: "Dining" });
    addTx(db, { date: "2025-10-13", amount: -5000, category: "Savings transfer" }); // transfers are not "out"
    addTx(db, { date: "2025-11-03", amount: -9000, category: "Dining" });

    const g = loadGrowth(db, "2025-11-18");
    expect(g.months.map((m) => [m.month, m.keptCents, m.partial])).toEqual([
      ["2025-08", 50000, true],
      ["2025-09", 70000, false],
      ["2025-10", 60000, false],
      ["2025-11", -9000, true],
    ]);
    expect(g.keptStreak).toBe(2);
  });

  it("returns net worth points in order with the change", () => {
    const db = freshDb();
    const row = { bankCents: 0, cryptoStableCents: 0, cryptoVolatileCents: 0, cryptoTradingCents: 0 };
    db.insert(schema.netWorthSnapshots).values({ day: "2025-11-02", ...row, totalCents: 15000 }).run();
    db.insert(schema.netWorthSnapshots).values({ day: "2025-11-01", ...row, totalCents: 10000 }).run();
    const g = loadGrowth(db, "2025-11-18");
    expect(g.netWorth.map((p) => p.day)).toEqual(["2025-11-01", "2025-11-02"]);
    expect(g.netWorthChangeCents).toBe(5000);
    expect(g.goal).toBeNull();
  });
});
