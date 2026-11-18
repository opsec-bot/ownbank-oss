import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { categorize, matchesRule, type RuleRow } from "@/lib/finance/categorize";
import { DEFAULT_RULES, DEFAULT_RULE_PRIORITY } from "@/lib/finance/default-rules";
import { applyRuleChange, previewRule, recategorizeAll, runPendingTasks } from "@/lib/finance/recategorize";
import { addAccount, addTx, catId, freshDb } from "../helpers/seed";

type Db = ReturnType<typeof freshDb>;

function cat(db: Db, description: string, amount = -1000, payee: string | null = null) {
  const rules: RuleRow[] = db.select().from(schema.rules).all();
  const ids = new Map(db.select().from(schema.categories).all().map((c) => [c.name, c.id]));
  const c = categorize({ description, counterparty: payee, amountCents: amount, mcc: null }, rules, ids);
  return db.select().from(schema.categories).where(eq(schema.categories.id, c.categoryId ?? -1)).get()?.name;
}

describe("default rules migration", () => {
  it("seeds every rule from the list, all flagged default with low priority", () => {
    const db = freshDb();
    const rows = db.select().from(schema.rules).all();
    expect(rows).toHaveLength(DEFAULT_RULES.length);
    expect(DEFAULT_RULES.length).toBeGreaterThanOrEqual(60);
    expect(rows.every((r) => r.isDefault && r.priority === DEFAULT_RULE_PRIORITY && r.enabled)).toBe(true);
    expect(rows.map((r) => r.pattern)).toEqual(DEFAULT_RULES.map((r) => r.pattern));
  });
  it("adds the new categories with the right kinds", () => {
    const db = freshDb();
    const k = (n: string) => db.select().from(schema.categories).where(eq(schema.categories.name, n)).get()?.kind;
    expect(k("Savings transfer")).toBe("transfer");
    expect(k("Personal transfer")).toBe("transfer");
    expect(k("Fees")).toBe("expense");
    expect(k("Cash & ATM")).toBe("expense");
    expect(k("Memecoin trading")).toBe("expense");
    expect(k("Trading realized")).toBe("income");
  });
});

describe("default rule matching", () => {
  const db = freshDb();
  const cases: [string, string][] = [
    ["HEB #123 AUSTIN TX", "Groceries"],
    ["WHEATHEBREAD CAFE", "Other"], // the heb pattern is word-bounded
    ["CHICK-FIL-A #4432", "Dining"],
    ["UBER EATS HELP.UBER.COM", "Dining"],
    ["UBER *TRIP", "Transport"],
    ["QT 1234 DALLAS", "Transport"],
    ["SHELL OIL 5712", "Transport"],
    ["NETFLIX.COM", "Subscriptions"],
    ["AMAZON PRIME*2K4", "Subscriptions"],
    ["AMAZON MKTPLACE", "Shopping"],
    ["WALMART GROCERY PICKUP", "Groceries"],
    ["WALMART SUPERCENTER", "Shopping"],
    ["COINBASE.COM", "Savings transfer"],
    ["CASH APP*BITCOIN", "Savings transfer"],
    ["CASH APP*JOHN", "Personal transfer"],
    ["ZELLE PAYMENT TO SOMEONE", "Personal transfer"],
    ["OVERDRAFT ITEM FEE", "Fees"],
    ["BKOFAMERICA ATM WITHDRAWAL", "Cash & ATM"],
    ["STEAMGAMES.COM 425", "Subscriptions"],
    ["TRANSFER DAILY PAY", "Other"], // nsf must not match inside "transfer"
    ["NSF FEE", "Fees"],
    ["DAILYPAY INSTANT TRANSFER FEE", "Fees"],
    ["MONTHLY MAINTENANCE FEE", "Fees"],
  ];
  for (const [desc, want] of cases) {
    it(`${desc} -> ${want}`, () => expect(cat(db, desc)).toBe(want));
  }
  it("matches the payee field too (field = any)", () => {
    expect(cat(db, "PURCHASE 1234", -500, "Starbucks")).toBe("Dining");
  });
});

describe("rule direction and inflows", () => {
  const db = freshDb();
  const cases: [string, number, string][] = [
    ["TRANSFER DAILY PAY", 15000, "Income"],
    ["DAILYPAY INC", 4200, "Income"],
    ["MCDONALDS #123 PAYROLL", 80000, "Income"], // employer payroll, not Dining
    ["MCDONALDS #123", 80000, "Income"], // unclaimed inflow of $20+ is income, never an expense rule
    ["MCDONALDS #123", -800, "Dining"],
    ["RESALE PAY DEP", 5000, "Income"],
    ["DIRECT DEP ACME", 123456, "Income"],
    ["STARBUCKS REFUND", 450, "Refund"],
    ["COINBASE.COM WITHDRAWAL", 50000, "Savings transfer"],
    ["COINBASE.COM", -50000, "Savings transfer"],
    ["Online Banking transfer from SAV 1234", 30000, "Transfer"],
    ["TRANSFER FROM CHK 9999", 30000, "Transfer"],
    ["OVERDRAFT FEE", 2500, "Income"], // an inflow can never be a Fee
    ["SHELL OIL", 1500, "Refund"],
  ];
  for (const [desc, amount, want] of cases) {
    it(`${desc} (${amount > 0 ? "in" : "out"}) -> ${want}`, () => expect(cat(db, desc, amount)).toBe(want));
  }
  it("respects rule direction in matchesRule", () => {
    const base: RuleRow = { id: 1, field: "any", matchType: "contains", pattern: "x", amountMinCents: null, amountMaxCents: null, categoryId: 1, priority: 0, enabled: true, direction: "out" };
    const tx = (a: number) => ({ description: "x", counterparty: null, amountCents: a });
    expect(matchesRule(base, tx(-100))).toBe(true);
    expect(matchesRule(base, tx(100))).toBe(false);
    expect(matchesRule({ ...base, direction: "in" }, tx(100))).toBe(true);
    expect(matchesRule({ ...base, direction: "in" }, tx(-100))).toBe(false);
    expect(matchesRule({ ...base, direction: "any" }, tx(-100))).toBe(true);
  });
  it("every default expense rule is outflow-only", () => {
    const exp = new Set(["Groceries", "Dining", "Transport", "Shopping", "Subscriptions", "Fees", "Cash & ATM"]);
    for (const r of DEFAULT_RULES) if (exp.has(r.category)) expect(r.direction).toBe("out");
    const rows = db.select().from(schema.rules).all();
    expect(rows.map((r) => r.direction)).toEqual(DEFAULT_RULES.map((r) => r.direction));
  });
  it("recategorize fixes inflows that an old expense rule had mislabeled", () => {
    const d2 = freshDb();
    addAccount(d2, "A1");
    const t = addTx(d2, { date: "2025-11-01", amount: 15000, description: "TRANSFER DAILY PAY", category: "Fees", source: "rule" });
    recategorizeAll(d2);
    expect(d2.select().from(schema.transactions).where(eq(schema.transactions.id, t)).get()?.categoryId).toBe(catId(d2, "Income"));
  });
});

describe("rule precedence and recategorize", () => {
  it("a user rule at normal priority beats a default rule", () => {
    const db = freshDb();
    db.insert(schema.rules)
      .values({ field: "any", matchType: "contains", pattern: "starbucks", categoryId: catId(db, "Entertainment"), priority: 0, createdAt: 1 })
      .run();
    expect(cat(db, "STARBUCKS #9")).toBe("Entertainment");
    expect(cat(db, "MCDONALDS #9")).toBe("Dining");
  });
  it("recategorizeAll changes rule/provider rows and never touches manual", () => {
    const db = freshDb();
    addAccount(db, "A1", { available: 1000 });
    const a = addTx(db, { date: "2025-11-01", amount: -500, description: "STARBUCKS 1", category: "Other", source: "provider" });
    const b = addTx(db, { date: "2025-11-01", amount: -500, description: "STARBUCKS 2", category: "Shopping", source: "manual" });
    expect(recategorizeAll(db)).toEqual({ checked: 1, changed: 1 });
    const get = (id: string) => db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get()!;
    expect(get(a)).toMatchObject({ categoryId: catId(db, "Dining"), categorySource: "rule" });
    expect(get(b)).toMatchObject({ categoryId: catId(db, "Shopping"), categorySource: "manual" });
  });
  it("applyRuleChange follows a rule being edited, disabled or deleted", () => {
    const db = freshDb();
    addAccount(db, "A1");
    const t = addTx(db, { date: "2025-11-01", amount: -500, description: "ZZZ CORNER SHOP" });
    const get = () => db.select().from(schema.transactions).where(eq(schema.transactions.id, t)).get()!;
    expect(get().categoryId).toBe(catId(db, "Other"));
    const r = db
      .insert(schema.rules)
      .values({ field: "any", matchType: "contains", pattern: "zzz corner", categoryId: catId(db, "Groceries"), createdAt: 1 })
      .returning({ id: schema.rules.id })
      .get();
    applyRuleChange(db);
    expect(get().categoryId).toBe(catId(db, "Groceries"));
    db.update(schema.rules).set({ categoryId: catId(db, "Dining") }).where(eq(schema.rules.id, r.id)).run();
    applyRuleChange(db);
    expect(get().categoryId).toBe(catId(db, "Dining"));
    db.update(schema.rules).set({ enabled: false }).where(eq(schema.rules.id, r.id)).run();
    applyRuleChange(db);
    expect(get().categoryId).toBe(catId(db, "Other"));
    db.update(schema.rules).set({ enabled: true }).where(eq(schema.rules.id, r.id)).run();
    applyRuleChange(db);
    db.delete(schema.rules).where(eq(schema.rules.id, r.id)).run();
    applyRuleChange(db);
    expect(get().categoryId).toBe(catId(db, "Other"));
  });
  it("runPendingTasks recategorizes once after the seed migration", () => {
    const db = freshDb();
    addAccount(db, "A1");
    addTx(db, { date: "2025-11-01", amount: -500, description: "CHIPOTLE 1", category: "Other", source: "provider" });
    expect(runPendingTasks(db)).toEqual(["recategorize", "rekey"]);
    expect(runPendingTasks(db)).toEqual([]);
  });
  it("previewRule counts matches, skipping manual rows", () => {
    const db = freshDb();
    addAccount(db, "A1");
    addTx(db, { date: "2025-11-01", amount: -500, description: "FOO BAR 1" });
    addTx(db, { date: "2025-11-02", amount: -500, description: "FOO BAR 2" });
    addTx(db, { date: "2025-11-03", amount: -500, description: "FOO BAR 3", category: "Dining", source: "manual" });
    addTx(db, { date: "2025-11-03", amount: -500, description: "OTHER" });
    const p = previewRule(db, {
      field: "any",
      matchType: "contains",
      pattern: "foo bar",
      amountMinCents: null,
      amountMaxCents: null,
      categoryId: 1,
      priority: 0,
      direction: "any",
    });
    expect(p.count).toBe(2);
    expect(p.sample).toEqual(["foo bar"]);
  });
  it("regex match type and absolute amount bounds", () => {
    const rule: RuleRow = {
      id: 1,
      field: "description",
      matchType: "regex",
      pattern: "^abc\\d+$",
      amountMinCents: 100,
      amountMaxCents: 500,
      categoryId: 1,
      priority: 0,
      enabled: true,
      direction: "any",
    };
    expect(matchesRule(rule, { description: "ABC123", counterparty: null, amountCents: -300 })).toBe(true);
    expect(matchesRule(rule, { description: "ABC123", counterparty: null, amountCents: -600 })).toBe(false);
    expect(matchesRule({ ...rule, pattern: "(" }, { description: "x", counterparty: null, amountCents: 200 })).toBe(false);
  });
});
