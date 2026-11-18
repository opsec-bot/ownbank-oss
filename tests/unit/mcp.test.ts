/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are parsed JSON, checked field by field */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { regexProblem } from "@/lib/finance/safe-regex";
import { rebuildRecurring } from "@/lib/finance/recurring";
import { schema, type DB } from "@/lib/db";
import {
  authenticate,
  bearerToken,
  hasScope,
  MCP_RATE_MAX,
  MCP_RATE_WINDOW_MS,
  staticTokenMatches,
  unauthorizedHeader,
  withinRateLimit,
  type Principal,
} from "@/lib/mcp/auth";
import { maskText, moneyify, scrub, toolText, ToolError, usd } from "@/lib/mcp/format";
import { buildMcpServer, toolsFor } from "@/lib/mcp/server";
import { TOOLS } from "@/lib/mcp/tools";
import { issueCode, parseAuthorize } from "@/lib/oauth/authorize";
import { registerClient } from "@/lib/oauth/clients";
import { exchangeCode } from "@/lib/oauth/tokens";
import { addAccount, addTx, catId, freshDb } from "../helpers/seed";

const NOW = Date.UTC(2025, 10, 18, 18, 0, 0); // 2025-11-18, 12:00 Central
const STATIC = "static-test-token-value";
const readOnly: Principal = { kind: "static", scopes: ["finance:read"], clientId: null, rateKey: "mcp:static" };
const writer: Principal = { kind: "oauth", scopes: ["finance:read", "finance:write"], clientId: "c", rateKey: "mcp:oauth:1" };

let db: DB;

function seed(): DB {
  const d = freshDb();
  addAccount(d, "A1", { name: "Fake Checking- 1234 (1234)", available: 200000, ledger: 210000 });
  d.update(schema.accounts).set({ lastFour: "1234" }).where(eq(schema.accounts.id, "A1")).run();
  addAccount(d, "A2", { name: "Fake Savings", available: 500000, ledger: 500000 });
  d.insert(schema.cryptoWallets)
    .values([
      { address: "SAVINGS1111111111111111111111111111111111111", label: "Vault", role: "savings", stableUsdCents: 100000, volatileUsdCents: 20000, totalUsdCents: 120000 },
      { address: "TRADING1111111111111111111111111111111111111", label: "Degen", role: "trading", stableUsdCents: 0, volatileUsdCents: 9000, totalUsdCents: 9000 },
    ])
    .run();
  addTx(d, { date: "2025-09-03", amount: -4000, description: "FAKE DINER 1234567890123456", category: "Dining" });
  addTx(d, { date: "2025-10-04", amount: -4000, description: "FAKE DINER", category: "Dining" });
  addTx(d, { date: "2025-11-04", amount: -10000, description: "FAKE DINER", category: "Dining" });
  addTx(d, { date: "2025-10-05", amount: -20000, description: "FAKE MARKET", category: "Groceries" });
  addTx(d, { date: "2025-11-05", amount: -20000, description: "FAKE MARKET", category: "Groceries" });
  addTx(d, { date: "2025-11-17", amount: -3000, description: "YESTERDAY SMALL", category: "Shopping" });
  for (const [dt, a] of [["2025-09-10", -1000], ["2025-10-10", -1000], ["2025-11-10", -1100]] as const) {
    addTx(d, { date: dt, amount: a, description: "FAKE STREAMING", payee: "Fake Streaming", category: "Subscriptions" });
  }
  for (const dt of ["2025-08-31", "2025-09-30", "2025-10-30"]) addTx(d, { date: dt, amount: 300000, description: "ACME PAYROLL", payee: "Acme", category: "Income" });
  rebuildRecurring(d, "2025-11-18");
  d.insert(schema.budgets).values({ categoryId: catId(d, "Dining"), monthlyLimitCents: 20000, createdAt: 0, updatedAt: 0 }).run();
  return d;
}

beforeEach(() => {
  db = seed();
  process.env.MCP_TOKEN = STATIC;
  delete process.env.MCP_WRITE_ENABLED;
  delete process.env.MCP_DIGEST_ENABLED;
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const tool = TOOLS.find((t) => t.name === name)!;
  const parsed = (await import("zod")).z.object(tool.input).parse(args); // applies the same defaults and validation as the SDK
  return JSON.parse(toolText(await tool.run({ db, now: NOW }, parsed)));
}

describe("bearer auth", () => {
  it("parses the header", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc")).toBe("abc");
    for (const bad of [null, undefined, "", "Basic abc", "Bearer", "Bearer a b", "abc"]) expect(bearerToken(bad)).toBeNull();
  });

  it("static token is compared in constant time and is off when MCP_TOKEN is unset", () => {
    expect(staticTokenMatches(STATIC, STATIC)).toBe(true);
    expect(staticTokenMatches(STATIC + "x", STATIC)).toBe(false);
    expect(staticTokenMatches("", STATIC)).toBe(false);
    expect(staticTokenMatches("anything", undefined)).toBe(false);
    expect(staticTokenMatches("", "")).toBe(false);
  });

  it("accepts the static token with read scope (write only when enabled)", () => {
    expect(authenticate(`Bearer ${STATIC}`, db, NOW)).toMatchObject({ kind: "static", scopes: ["finance:read"] });
    process.env.MCP_WRITE_ENABLED = "1";
    expect(authenticate(`Bearer ${STATIC}`, db, NOW)?.scopes).toEqual(["finance:read", "finance:write"]);
  });

  it("rejects missing and wrong tokens", () => {
    expect(authenticate(undefined, db, NOW)).toBeNull();
    expect(authenticate("Bearer nope", db, NOW)).toBeNull();
    delete process.env.MCP_TOKEN;
    expect(authenticate(`Bearer ${STATIC}`, db, NOW)).toBeNull();
  });

  it("accepts a live OAuth access token with its granted scopes, rejects expired and revoked", () => {
    const reg = registerClient({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }, db, NOW);
    if (!reg.ok) throw new Error("reg");
    const clientId = reg.body.client_id as string;
    const verifier = "v".repeat(50);
    const parsed = parseAuthorize(
      { client_id: clientId, redirect_uri: "https://claude.ai/api/mcp/auth_callback", response_type: "code", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" },
      db,
    );
    if (!parsed.ok) throw new Error("parse");
    const code = issueCode(db, parsed.req, NOW);
    const t = exchangeCode(db, { client_id: clientId, code, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_verifier: verifier }, NOW);
    if (!t.ok) throw new Error("exchange");
    const p = authenticate(`Bearer ${t.body.access_token}`, db, NOW + 1000);
    expect(p).toMatchObject({ kind: "oauth", clientId, scopes: ["finance:read"] });
    expect(authenticate(`Bearer ${t.body.access_token}`, db, NOW + 61 * 60 * 1000)).toBeNull();
    db.update(schema.oauthTokens).set({ revokedAt: NOW }).run();
    expect(authenticate(`Bearer ${t.body.access_token}`, db, NOW + 1000)).toBeNull();
  });

  it("builds the WWW-Authenticate challenge from APP_URL", () => {
    expect(unauthorizedHeader()).toBe('Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"');
  });

  it("limits to 60 requests a minute per token and resets the next window", () => {
    const hits = Array.from({ length: MCP_RATE_MAX + 5 }, () => withinRateLimit(readOnly, db, NOW));
    expect(hits.filter(Boolean)).toHaveLength(MCP_RATE_MAX);
    expect(withinRateLimit({ ...readOnly, rateKey: "mcp:oauth:9" }, db, NOW)).toBe(true);
    expect(withinRateLimit(readOnly, db, NOW + MCP_RATE_WINDOW_MS)).toBe(true);
  });
});

describe("scopes decide which tools exist", () => {
  const names = (p: Principal) => toolsFor(p).map((t) => t.name);

  it("read caller gets read tools and publish_digest, never write tools", () => {
    const n = names(readOnly);
    expect(n).toContain("get_balances");
    expect(n).toContain("publish_digest");
    for (const w of ["recategorize_transaction", "create_rule", "set_budget"]) expect(n).not.toContain(w);
  });

  it("write tools need the scope AND MCP_WRITE_ENABLED", () => {
    expect(names(writer)).not.toContain("create_rule");
    process.env.MCP_WRITE_ENABLED = "1";
    expect(names(writer)).toEqual(expect.arrayContaining(["recategorize_transaction", "create_rule", "set_budget"]));
    expect(names(readOnly)).not.toContain("create_rule");
  });

  it("MCP_DIGEST_ENABLED=0 removes publish_digest", () => {
    process.env.MCP_DIGEST_ENABLED = "0";
    expect(names(readOnly)).not.toContain("publish_digest");
  });

  it("hasScope", () => {
    expect(hasScope(readOnly, "finance:read")).toBe(true);
    expect(hasScope(readOnly, "finance:write")).toBe(false);
  });

  it("every tool has a title, a description and the four annotations once registered", () => {
    process.env.MCP_WRITE_ENABLED = "1";
    for (const t of TOOLS) {
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(20);
    }
    expect(() => buildMcpServer(writer, { db, now: () => NOW })).not.toThrow();
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });
});

describe("formatting and masking", () => {
  it("formats dollars with two decimals", () => {
    expect(usd(1234)).toBe("12.34");
    expect(usd(-5)).toBe("-0.05");
    expect(usd(0)).toBe("0.00");
    expect(usd(-1000000)).toBe("-10000.00");
  });

  it("renames Cents keys to Usd strings", () => {
    expect(moneyify({ a: { balanceCents: 1050, other: null, xCents: null }, l: [{ yCents: -1 }] })).toEqual({
      a: { balanceUsd: "10.50", other: null, xUsd: null },
      l: [{ yUsd: "-0.01" }],
    });
  });

  it("masks card numbers and long digit runs, keeps short numbers and dollar amounts", () => {
    expect(maskText("PURCHASE 4111 1111 1111 1111 STORE")).toBe("PURCHASE ****1111 STORE");
    expect(maskText("card 4111-1111-1111-1111")).toBe("card ****1111");
    expect(maskText("ACCT 123456789012 REF")).toBe("ACCT ********9012 REF");
    expect(maskText("STORE #38113 TX")).toBe("STORE #*8113 TX");
    expect(maskText("SHOP 1234 on 11/18")).toBe("SHOP 1234 on 11/18");
    const out = scrub({ id: "1234567890", amountUsd: "12345.67", note: "ref 99887766" }) as Record<string, string>;
    expect(out).toEqual({ id: "1234567890", amountUsd: "12345.67", note: "ref ****7766" });
  });
});

describe("read tools", () => {
  it("get_balances separates trading wallets and counts net worth without them", async () => {
    const r = await call("get_balances");
    expect(r.bankAccounts.map((a: any) => a.name).sort()).toEqual(["Fake Checking", "Fake Savings"]);
    expect(r.bankAccounts.find((a: any) => a.name === "Fake Checking")).toMatchObject({ last4: "1234", balanceUsd: "2100.00" });
    expect(r.savingsWallets).toHaveLength(1);
    expect(r.savingsWallets[0]).toMatchObject({ label: "Vault", counted: true, totalUsd: "1200.00" });
    expect(r.tradingWallets[0]).toMatchObject({ label: "Degen", counted: false, totalUsd: "90.00" });
    expect(r.totals.netWorthUsd).toBe("8300.00"); // 2100 + 5000 + 1200, trading excluded
    expect(r.totals.tradingNotCountedUsd).toBe("90.00");
    expect(JSON.stringify(r)).not.toContain("SAVINGS1111");
    expect(r.savingsWallets[0].addressLast4).toBe("1111");
  });

  it("list_transactions filters, trims, masks and shows account last four", async () => {
    const r = await call("list_transactions", { start: "2025-09-01", end: "2025-09-30", category: "dining" });
    expect(r.totalMatches).toBe(1);
    expect(r.transactions[0]).toMatchObject({ date: "2025-09-03", amountUsd: "-40.00", category: "Dining", account: "Fake Checking", accountLast4: "1234", status: "posted" });
    expect(r.transactions[0].description).toBe("FAKE DINER ****3456");
    const money = await call("list_transactions", { start: "2025-11-01", end: "2025-11-30", direction: "in" });
    expect(money.totalMatches).toBe(0);
    const inflow = await call("list_transactions", { start: "2025-10-01", end: "2025-10-31", direction: "in", account: "1234" });
    expect(inflow.transactions).toHaveLength(1);
    const search = await call("list_transactions", { start: "2025-01-01", end: "2025-12-31", search: "streaming", limit: 2 });
    expect(search.returned).toBe(2);
    expect(search.totalMatches).toBe(3);
  });

  it("list_transactions rejects bad input", async () => {
    const tool = TOOLS.find((t) => t.name === "list_transactions")!;
    const { z } = await import("zod");
    const schemaObj = z.object(tool.input);
    expect(schemaObj.safeParse({ start: "2025-13-01", end: "2025-12-01" }).success).toBe(false);
    expect(schemaObj.safeParse({ start: "2025-01-01", end: "2025-12-01", limit: 501 }).success).toBe(false);
    await expect(call("list_transactions", { start: "2025-12-01", end: "2025-01-01" })).rejects.toBeInstanceOf(ToolError);
    await expect(call("list_transactions", { start: "2025-01-01", end: "2025-12-01", category: "Nope" })).rejects.toBeInstanceOf(ToolError);
    await expect(call("list_transactions", { start: "2025-01-01", end: "2025-12-01", account: "9999" })).rejects.toBeInstanceOf(ToolError);
  });

  it("spending_by_category and merchant exclude income", async () => {
    const c = await call("spending_by_category", { start: "2025-11-01", end: "2025-11-18" });
    expect(c.totalUsd).toBe("341.00");
    expect(c.categories[0]).toMatchObject({ category: "Groceries", spentUsd: "200.00" });
    expect(c.categories.map((x: any) => x.category)).not.toContain("Income");
    const m = await call("spending_by_merchant", { start: "2025-11-01", end: "2025-11-18", category: "Dining" });
    expect(m.merchants).toHaveLength(1);
    expect(m.merchants[0]).toMatchObject({ spentUsd: "100.00", transactions: 1 });
  });

  it("compare_periods gives per-category deltas, B minus A", async () => {
    const r = await call("compare_periods", { a_start: "2025-10-01", a_end: "2025-10-31", b_start: "2025-11-01", b_end: "2025-11-18" });
    const dining = r.categories.find((c: any) => c.category === "Dining");
    expect(dining).toMatchObject({ aUsd: "40.00", bUsd: "100.00", changeUsd: "60.00", changePct: 150 });
    expect(r.totals.changeUsd).toBeDefined();
  });

  it("cash_flow reports in, out and net", async () => {
    const r = await call("cash_flow", { start: "2025-10-01", end: "2025-10-31" });
    expect(r).toMatchObject({ inUsd: "3000.00", outUsd: "250.00", netUsd: "2750.00" });
  });

  it("list_recurring_charges, forecast, sync_status, safe_to_spend return sane shapes", async () => {
    const rec = await call("list_recurring_charges");
    expect(rec.charges.some((c: any) => /streaming/i.test(c.name))).toBe(true);
    const f = await call("forecast_month_end");
    expect(f).toMatchObject({ today: "2025-11-18", monthEnd: "2025-11-30" });
    expect(typeof f.projectedEndUsd).toBe("string");
    const s = await call("sync_status");
    expect(s.connection).toMatchObject({ status: "active" });
    expect(s.connection.provider).toBe("simplefin");
    expect(JSON.stringify(s)).not.toMatch(/bridge\.invalid|https?:/);
    const safe = await call("safe_to_spend");
    expect(typeof safe.safeToSpendUsd).toBe("string");
  });

  it("can_afford answers yes for small and no for huge, and checks input", async () => {
    const small = await call("can_afford", { amount: 5 });
    expect(small.affordable).toBe(true);
    expect(small.amountUsd).toBe("5.00");
    const big = await call("can_afford", { amount: 50000 });
    expect(big.affordable).toBe(false);
    expect(big.reason.length).toBeGreaterThan(5);
    const { z } = await import("zod");
    expect(z.object(TOOLS.find((t) => t.name === "can_afford")!.input).safeParse({ amount: -5 }).success).toBe(false);
  });

  it("save_plan, budgets_status, savings_goal, categories, rules", async () => {
    const plan = await call("save_plan");
    expect(plan.savePercent).toBe(20);
    const b = await call("budgets_status");
    expect(b.budgets[0]).toMatchObject({ category: "Dining", limitUsd: "200.00", spentUsd: "100.00", pct: 50 });
    expect(await call("savings_goal")).toMatchObject({ goal: null });
    db.insert(schema.savingsGoal).values({ id: 1, name: "Cushion", targetCents: 200000, createdAt: 0 }).run();
    expect((await call("savings_goal")).goal).toMatchObject({ name: "Cushion", targetUsd: "2000.00" });
    const cats = await call("list_categories");
    expect(cats.categories.find((c: any) => c.name === "Dining")).toMatchObject({ kind: "expense", hasBudget: true });
    const rules = await call("list_rules");
    expect(rules.count).toBe(0); // defaults hidden
    expect((await call("list_rules", { include_defaults: true })).count).toBeGreaterThan(10);
  });

  it("get_digest_data wraps buildDigestData with dollars and ISO times", async () => {
    const d = await call("get_digest_data");
    expect(d.date).toBe("2025-11-18");
    expect(d.yesterday.outflowUsd).toBe("30.00");
    expect(d.connection.status).toBe("active");
    const past = await call("get_digest_data", { date: "2025-11-10" });
    expect(past.date).toBe("2025-11-10");
    await expect(call("get_digest_data", { date: "2025-12-31" })).rejects.toBeInstanceOf(ToolError);
  });

  it("no output holds a 5+ digit run that is not a dollar amount", async () => {
    const calls: [string, Record<string, unknown>][] = [
      ["get_balances", {}],
      ["list_transactions", { start: "2025-01-01", end: "2025-12-31", limit: 500 }],
      ["spending_by_category", { start: "2025-01-01", end: "2025-12-31" }],
      ["get_digest_data", {}],
      ["list_rules", { include_defaults: true }],
      ["sync_status", {}],
    ];
    for (const [name, args] of calls) {
      const text = JSON.stringify(await call(name, args));
      const stripped = text.replace(/-?\d+\.\d{2}/g, "");
      expect(stripped.match(/\d{5,}/g), name).toBeNull();
    }
  });
});

describe("publish_digest", () => {
  it("stores the digest as claude for the day and reports the push status", async () => {
    const r = await call("publish_digest", { markdown: "Good morning. All fine." });
    expect(r).toMatchObject({ stored: true, date: "2025-11-18" });
    const row = db.select().from(schema.digests).get()!;
    expect(row).toMatchObject({ day: "2025-11-18", source: "claude", bodyMd: "Good morning. All fine." });
    await call("publish_digest", { markdown: "Second take", date: "2025-11-18" });
    expect(db.select().from(schema.digests).all()).toHaveLength(1);
  });

  it("limits length and date", async () => {
    const { z } = await import("zod");
    const input = z.object(TOOLS.find((t) => t.name === "publish_digest")!.input);
    expect(input.safeParse({ markdown: "x".repeat(4001) }).success).toBe(false);
    expect(input.safeParse({ markdown: "" }).success).toBe(false);
    await expect(call("publish_digest", { markdown: "hi", date: "2025-11-19" })).rejects.toBeInstanceOf(ToolError);
    await expect(call("publish_digest", { markdown: "hi", date: "2025-10-01" })).rejects.toBeInstanceOf(ToolError);
  });
});

describe("write tools", () => {
  it("recategorize_transaction sets a manual category", async () => {
    const id = addTx(db, { date: "2025-11-12", amount: -2500, description: "MYSTERY SHOP", category: "Other" });
    const r = await call("recategorize_transaction", { transaction_id: id, category: "shopping" });
    expect(r.updated).toMatchObject({ category: "Shopping", categorySource: "manual" });
    expect(r.previousCategory).toBe("Other");
    expect(db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get()?.categorySource).toBe("manual");
    await expect(call("recategorize_transaction", { transaction_id: "ghost", category: "Shopping" })).rejects.toBeInstanceOf(ToolError);
    await expect(call("recategorize_transaction", { transaction_id: id, category: "Nope" })).rejects.toBeInstanceOf(ToolError);
  });

  it("create_rule reports matches, recategorizes, and is idempotent", async () => {
    addTx(db, { date: "2025-11-12", amount: -2500, description: "ZORBLAX COFFEE 1", category: "Other", source: "provider" });
    addTx(db, { date: "2025-11-13", amount: -2600, description: "ZORBLAX COFFEE 2", category: "Other", source: "provider" });
    const r = await call("create_rule", { pattern: "zorblax", category: "Dining" });
    expect(r).toMatchObject({ alreadyExisted: false, matched: 2, category: "Dining" });
    expect(r.recategorized).toBeGreaterThanOrEqual(2); // the whole pass re-runs, other rows may move too
    const again = await call("create_rule", { pattern: "ZORBLAX", category: "Dining" });
    expect(again).toMatchObject({ alreadyExisted: true, ruleId: r.ruleId });
    expect(db.select().from(schema.rules).all().filter((x) => x.pattern.toLowerCase() === "zorblax")).toHaveLength(1);
    const dry = await call("create_rule", { pattern: "other thing", category: "Dining", apply_now: false });
    expect(dry.recategorized).toBeNull();
  });

  it("create_rule refuses dangerous regexes", async () => {
    for (const bad of ["(a+)+$", "(.*)*x", "(a|aa)+", "(\\w+\\s?)*", "(a)\\1", "(?=a)b", "a".repeat(101)]) {
      await expect(call("create_rule", { pattern: bad, match_type: "regex", category: "Dining" }), bad).rejects.toBeInstanceOf(ToolError);
    }
    const ok = await call("create_rule", { pattern: "^zorblax\\s+coffee", match_type: "regex", category: "Dining", apply_now: false });
    expect(ok.ruleId).toBeGreaterThan(0);
    await expect(call("create_rule", { pattern: "x", category: "Dining", amount_min: 10, amount_max: 5 })).rejects.toBeInstanceOf(ToolError);
  });

  it("set_budget upserts and only allows expense categories", async () => {
    const r = await call("set_budget", { category: "Dining", monthly_limit: 350 });
    expect(r).toMatchObject({ category: "Dining", monthlyLimitUsd: "350.00" });
    expect(db.select().from(schema.budgets).all()).toHaveLength(1);
    await expect(call("set_budget", { category: "Income", monthly_limit: 100 })).rejects.toBeInstanceOf(ToolError);
  });
});

describe("regexProblem", () => {
  it("accepts ordinary patterns", () => {
    for (const p of ["^uber\\s+eats", "shell|exxon", "pay(roll|check)", "\\d{3}-\\d{4}", "star?bucks", "[a-z]+ coffee", "a.{0,5}b"]) {
      expect(regexProblem(p), p).toBeNull();
    }
  });
  it("rejects bad syntax, empties and long ones", () => {
    expect(regexProblem("(")).toMatch(/compile/);
    expect(regexProblem("")).not.toBeNull();
    expect(regexProblem("x".repeat(200))).toMatch(/too long/);
  });
});
