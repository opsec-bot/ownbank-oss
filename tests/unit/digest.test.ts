import { describe, expect, it } from "vitest";
import { buildDigestData, renderAutoDigest } from "@/lib/finance/digest";
import { parseInline, parseMarkdown } from "@/lib/finance/markdown";
import { rebuildRecurring } from "@/lib/finance/recurring";
import { schema } from "@/lib/db";
import { addAccount, addTx, freshDb } from "../helpers/seed";

const NOW = Date.UTC(2025, 10, 18, 18, 0, 0); // 2025-11-18

function seed() {
  const db = freshDb();
  addAccount(db, "A1", { available: 200000, ledger: 210000 });
  addAccount(db, "A2", { name: "Fake Savings", available: 500000, ledger: 500000 });
  // History: Sept 1 .. Nov 17. Dining: Oct 30/Sept 30 same point; groceries steady.
  addTx(db, { date: "2025-09-03", amount: -4000, description: "FAKE DINER", category: "Dining" });
  addTx(db, { date: "2025-10-04", amount: -4000, description: "FAKE DINER", category: "Dining" });
  addTx(db, { date: "2025-11-04", amount: -10000, description: "FAKE DINER", category: "Dining" }); // way over its usual
  addTx(db, { date: "2025-10-05", amount: -20000, description: "FAKE MARKET", category: "Groceries" });
  addTx(db, { date: "2025-11-05", amount: -20000, description: "FAKE MARKET", category: "Groceries" });
  // Yesterday.
  addTx(db, { date: "2025-11-17", amount: -3000, description: "YESTERDAY SMALL", category: "Shopping" });
  addTx(db, { date: "2025-11-17", amount: -9000, description: "YESTERDAY BIG", category: "Shopping" });
  addTx(db, { date: "2025-11-17", amount: -50000, description: "TRANSFER OUT", category: "Savings transfer" });
  // Subscription that rose, income.
  for (const [d, a] of [["2025-09-10", -1000], ["2025-10-10", -1000], ["2025-11-10", -1100]] as const) {
    addTx(db, { date: d, amount: a, description: "FAKE STREAMING", payee: "Fake Streaming", category: "Subscriptions" });
  }
  for (const d of ["2025-08-31", "2025-09-30", "2025-10-30"]) addTx(db, { date: d, amount: 300000, description: "ACME PAYROLL", payee: "Acme", category: "Income" });
  rebuildRecurring(db, "2025-11-18");
  // Start the history early enough to cover September.
  addTx(db, { date: "2025-08-30", amount: -100, description: "OLD", category: "Other" });
  return db;
}

describe("buildDigestData", () => {
  const db = seed();
  const d = buildDigestData(db, NOW);

  it("reports yesterday's outflows and top transactions (transfers excluded)", () => {
    expect(d.date).toBe("2025-11-18");
    expect(d.yesterday.date).toBe("2025-11-17");
    expect(d.yesterday.outflowCents).toBe(12000);
    expect(d.yesterday.top.map((t) => [t.merchantKey, t.amountCents, t.category])).toEqual([
      ["yesterday big", 9000, "Shopping"],
      ["yesterday small", 3000, "Shopping"],
    ]);
  });
  it("compares month to date with the same point last month", () => {
    // Nov 1-18 expense spend: 10000 + 20000 + 12000 + 1200 = 43200 ; Oct 1-18: 4000 + 20000 + 1000 = 25000
    expect(d.month.spendCents).toBe(10000 + 20000 + 3000 + 9000 + 1100);
    expect(d.month.lastMonthSamePointCents).toBe(4000 + 20000 + 1000);
  });
  it("flags categories more than 25% over their same-point 3-month average", () => {
    const dining = d.categories.find((c) => c.name === "Dining")!;
    expect(dining).toMatchObject({ mtdCents: 10000, avg3mCents: 4000, overPct: 150, flagged: true });
    // September had no groceries, so the average is (0 + 20000) / 2
    const groceries = d.categories.find((c) => c.name === "Groceries")!;
    expect(groceries).toMatchObject({ avg3mCents: 10000, overPct: 100, flagged: true });
    const shopping = d.categories.find((c) => c.name === "Shopping")!;
    expect(shopping.flagged).toBe(false); // no past data: avg is 0, never flagged
  });
  it("lists subscription price rises and bills due in 7 days", () => {
    expect(d.subscriptions.raised.map((r) => [r.name, r.pct])).toEqual([["Fake Streaming", 10]]);
    expect(d.billsDue).toEqual([]);
  });
  it("reports balances, savings, net worth and connection health", () => {
    expect(d.balances.checkingCents).toBe(200000);
    expect(d.balances.bankCashCents).toBe(710000);
    expect(d.netWorth).toEqual({ totalCents: 710000, change1dCents: null, change30dCents: null });
    expect(d.savings).toEqual({ stableCents: 0, volatileCents: 0, tradingCents: 0 });
    expect(d.savingsTransfersMtd).toEqual({ count: 1, cents: 50000 });
    expect(d.connection).toMatchObject({ status: "active", lastSyncedAt: null });
    expect(d.forecast.nextIncomeDate).toBe("2025-11-30");
  });
  it("is deterministic", () => {
    expect(JSON.stringify(buildDigestData(db, NOW))).toBe(JSON.stringify(d));
  });
  it("includes net worth change once snapshots exist and trading flows", () => {
    const db2 = seed();
    db2.insert(schema.netWorthSnapshots).values({ day: "2025-11-17", bankCents: 700000, cryptoStableCents: 0, cryptoVolatileCents: 0, totalCents: 700000 }).run();
    db2.insert(schema.walletFlows).values({ signature: "s", day: "2025-11-12", fromAddress: "a", toAddress: "b", mint: "SOL", symbol: "SOL", amountRaw: "1", usdCents: 4200, kind: "trading_funded" }).run();
    const x = buildDigestData(db2, NOW);
    expect(x.netWorth.change1dCents).toBe(10000);
    expect(x.trading).toEqual({ fundedMtdCents: 4200, realizedMtdCents: 0 });
    expect(x.month.spendCents).toBe(d.month.spendCents + 4200);
  });
});

describe("renderAutoDigest", () => {
  it("is short plain bullet lines with numbers only", () => {
    const text = renderAutoDigest(buildDigestData(seed(), NOW));
    const lines = text.split("\n");
    expect(lines[0]).toBe("Digest for 2025-11-18");
    expect(text).toContain("- Yesterday: $120.00 out");
    expect(text).toContain("- Dining: $100.00 this month, 150% over its usual $40.00");
    expect(text).toContain("Price up 10%: Fake Streaming");
    expect(lines.length).toBeLessThan(25);
    expect(text).not.toMatch(/<|>/);
  });
});

describe("markdown", () => {
  it("parses headings, lists, paragraphs and inline styles", () => {
    const blocks = parseMarkdown("# Title\n\nHello **bold** and `code`.\nSecond line\n\n- one\n  - nested\n- two");
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(blocks[1]).toEqual({
      type: "paragraph",
      inline: [{ text: "Hello " }, { text: "bold", bold: true }, { text: " and " }, { text: "code", code: true }, { text: ". Second line" }],
    });
    expect(blocks[2]).toMatchObject({ type: "list", items: [{ depth: 0 }, { depth: 1 }, { depth: 0 }] });
  });
  it("never produces HTML: raw tags stay plain text", () => {
    const blocks = parseMarkdown("<script>alert(1)</script>\n\n[link](javascript:alert(1))");
    expect(JSON.stringify(blocks)).toContain("<script>alert(1)</script>");
    expect(blocks.every((b) => b.type === "paragraph")).toBe(true);
    expect(parseInline("<b>x</b>")).toEqual([{ text: "<b>x</b>" }]);
  });
});
