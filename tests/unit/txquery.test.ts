import { describe, expect, it } from "vitest";
import { ftsQuery, getTransaction, parseFilters, queryTransactions, type TxFilters } from "@/lib/finance/tx-query";
import { addAccount, addTx, catId, freshDb } from "../helpers/seed";

const none: TxFilters = { q: "", account: "", category: "", from: "", to: "", dir: "", pending: false, merchant: "" };

describe("ftsQuery / parseFilters", () => {
  it("turns text into quoted prefix tokens and drops FTS syntax", () => {
    expect(ftsQuery("Chick-fil-A")).toBe('"chick"* "fil"* "a"*');
    expect(ftsQuery('foo" OR bar*')).toBe('"foo"* "or"* "bar"*');
    expect(ftsQuery("  ***  ")).toBeNull();
  });
  it("sanitizes query params", () => {
    const f = parseFilters({ q: "x", dir: "sideways", from: "2025-1-1", to: "2025-11-30", cat: "12", pending: "1", acct: "A1" });
    expect(f).toEqual({ q: "x", account: "A1", category: "12", from: "", to: "2025-11-30", dir: "", pending: true, merchant: "" });
    expect(parseFilters({ cat: "1 OR 1=1" }).category).toBe("");
  });
});

describe("queryTransactions", () => {
  function seed() {
    const db = freshDb();
    addAccount(db, "A1");
    addAccount(db, "A2", { name: "Fake Card", type: "credit" });
    addTx(db, { date: "2025-11-01", amount: -1200, description: "STARBUCKS STORE 12", category: "Dining" });
    addTx(db, { date: "2025-11-02", amount: -5000, description: "HEB GROCERY", payee: "H-E-B", category: "Groceries" });
    addTx(db, { date: "2025-11-03", amount: 90000, description: "ACME PAYROLL", category: "Income", account: "A1" });
    addTx(db, { date: "2025-11-04", amount: -700, description: "PENDING SNACK", category: "Dining", status: "pending", account: "A2" });
    addTx(db, { date: "2025-11-05", amount: -300, description: "MYSTERY", category: null });
    return db;
  }
  it("full-text searches description and payee by prefix", () => {
    const db = seed();
    expect(queryTransactions(db, { ...none, q: "starb" }, 1).total).toBe(1);
    expect(queryTransactions(db, { ...none, q: "h-e-b" }, 1).total).toBe(1);
    expect(queryTransactions(db, { ...none, q: "nothing here" }, 1).total).toBe(0);
    expect(queryTransactions(db, { ...none, q: "!!!" }, 1).total).toBe(0);
  });
  it("filters by account, category, dates, direction and pending", () => {
    const db = seed();
    expect(queryTransactions(db, { ...none, account: "A2" }, 1).total).toBe(1);
    expect(queryTransactions(db, { ...none, category: String(catId(db, "Dining")) }, 1).total).toBe(2);
    expect(queryTransactions(db, { ...none, category: "none" }, 1).total).toBe(1);
    expect(queryTransactions(db, { ...none, from: "2025-11-02", to: "2025-11-03" }, 1).total).toBe(2);
    expect(queryTransactions(db, { ...none, dir: "in" }, 1).total).toBe(1);
    expect(queryTransactions(db, { ...none, dir: "out" }, 1).total).toBe(4);
    expect(queryTransactions(db, { ...none, pending: true }, 1).total).toBe(1);
  });
  it("combines filters, orders newest first and paginates", () => {
    const db = seed();
    const all = queryTransactions(db, none, 1);
    expect(all.rows.map((r) => r.date)).toEqual(["2025-11-05", "2025-11-04", "2025-11-03", "2025-11-02", "2025-11-01"]);
    const p2 = queryTransactions(db, none, 2, 2);
    expect(p2.pages).toBe(3);
    expect(p2.rows.map((r) => r.date)).toEqual(["2025-11-03", "2025-11-02"]);
    expect(queryTransactions(db, none, 99, 2).rows).toHaveLength(1); // clamps to the last page
    expect(queryTransactions(db, { ...none, dir: "out", q: "snack" }, 1).total).toBe(1);
  });
  it("stays in sync with the FTS index on update and delete", () => {
    const db = seed();
    db.$client.prepare("UPDATE transactions SET description = 'RENAMED THING' WHERE description = 'MYSTERY'").run();
    expect(queryTransactions(db, { ...none, q: "mystery" }, 1).total).toBe(0);
    expect(queryTransactions(db, { ...none, q: "renamed" }, 1).total).toBe(1);
    db.$client.prepare("DELETE FROM transactions WHERE description = 'RENAMED THING'").run();
    expect(queryTransactions(db, { ...none, q: "renamed" }, 1).total).toBe(0);
  });
  it("getTransaction returns joined names", () => {
    const db = seed();
    const row = queryTransactions(db, { ...none, q: "payroll" }, 1).rows[0];
    expect(getTransaction(db, row.id)).toMatchObject({ categoryName: "Income", accountName: "Fake Checking" });
    expect(getTransaction(db, "nope")).toBeNull();
  });
});
