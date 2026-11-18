import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { DAILY_REQUEST_BUDGET, isSyncRunning, requestsInLast24h } from "@/lib/bank/sync";
import { localDate } from "@/lib/bank/normalize";
import { schema, type DB } from "@/lib/db";
import { canAfford, safeToSpend } from "@/lib/finance/afford";
import { loadBills } from "@/lib/finance/bills";
import { loadBudgets, setBudget } from "@/lib/finance/budgets";
import { buildDigestData, publishDigest } from "@/lib/finance/digest";
import { monthEnd, shiftDays } from "@/lib/finance/dates";
import { bankCashCents, checkingCents, loadForecast } from "@/lib/finance/forecast";
import { getGoal, goalPerDepositCents, loadGoalProgress } from "@/lib/finance/goal";
import { cryptoSplit, displayAccountName } from "@/lib/finance/networth";
import { applyRuleChange, previewRule } from "@/lib/finance/recategorize";
import { rebuildRecurring } from "@/lib/finance/recurring";
import { regexProblem } from "@/lib/finance/safe-regex";
import { latestSuggestion, weeklyRollup } from "@/lib/finance/save-plan";
import { computeSnapshot, netWorthChange } from "@/lib/finance/snapshots";
import { cashFlow, categorySpend, savingsTransfers, spendBetween, tradingFlows } from "@/lib/finance/stats";
import { getTransaction, queryTransactions, type TxFilters, type TxRow } from "@/lib/finance/tx-query";
import { SCOPE_READ, SCOPE_WRITE, type Scope } from "@/lib/oauth/config";
import { iso, safeError, shortText, ToolError } from "./format";

export type ToolCtx = { db: DB; now: number };

// read   = needs finance:read
// digest = needs finance:read, appends a digest and pushes it (narrow write, MCP_DIGEST_ENABLED=0 turns it off)
// write  = needs finance:write AND MCP_WRITE_ENABLED
export type ToolKind = "read" | "digest" | "write";

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  kind: ToolKind;
  readOnly: boolean;
  idempotent: boolean;
  input: z.ZodRawShape;
  run: (ctx: ToolCtx, args: Record<string, unknown>) => unknown | Promise<unknown>;
};

export function requiredScope(kind: ToolKind): Scope {
  return kind === "write" ? SCOPE_WRITE : SCOPE_READ;
}

function def<S extends z.ZodRawShape>(d: {
  name: string;
  title: string;
  description: string;
  kind?: ToolKind;
  readOnly?: boolean;
  idempotent?: boolean;
  input?: S;
  run: (ctx: ToolCtx, args: z.infer<z.ZodObject<S>>) => unknown | Promise<unknown>;
}): ToolDef {
  return {
    name: d.name,
    title: d.title,
    description: d.description,
    kind: d.kind ?? "read",
    readOnly: d.readOnly ?? (d.kind ?? "read") === "read",
    idempotent: d.idempotent ?? true,
    input: (d.input ?? {}) as z.ZodRawShape,
    run: d.run as ToolDef["run"],
  };
}

// ---------- shared helpers ----------

const today = (now: number) => localDate(Math.floor(now / 1000));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const dateArg = (what: string) => z.string().refine(validDate, `${what} must be a real date, YYYY-MM-DD`);

function checkRange(start: string, end: string) {
  if (start > end) throw new ToolError("start must be on or before end");
}

function findCategory(db: DB, name: string) {
  const all = db.select().from(schema.categories).all();
  const hit = all.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  if (!hit) throw new ToolError(`Unknown category "${name.slice(0, 60)}". Call list_categories for the valid names.`);
  return hit;
}

function visibleAccounts(db: DB) {
  return db.select().from(schema.accounts).orderBy(schema.accounts.name).all().filter((a) => !a.hidden);
}

function findAccount(db: DB, query: string) {
  const q = query.trim().toLowerCase();
  const all = db.select().from(schema.accounts).all();
  const exact = all.filter((a) => a.id === query || (a.lastFour && a.lastFour === q));
  const hits = exact.length ? exact : all.filter((a) => displayAccountName(a.name).toLowerCase().includes(q));
  if (hits.length === 0) throw new ToolError("No account matches that. Call get_balances for the account names and last four digits.");
  if (hits.length > 1) throw new ToolError("More than one account matches. Use the last four digits.");
  return hits[0];
}

function txOut(r: TxRow) {
  return {
    id: r.id,
    date: r.date,
    amountCents: r.amountCents,
    description: shortText(r.description),
    merchant: r.merchantKey ? shortText(r.merchantKey, 40) : null,
    category: r.categoryName ?? "Uncategorized",
    categorySource: r.categorySource,
    account: displayAccountName(r.accountName),
    accountLast4: r.lastFour,
    status: r.status,
  };
}

// ---------- read tools ----------

const getBalances = def({
  name: "get_balances",
  title: "Balances and net worth",
  description:
    "Current balances: bank accounts, savings wallets (stable vs volatile), trading wallets (listed separately and NOT counted), and net worth.",
  run: ({ db, now }) => {
    const accounts = visibleAccounts(db);
    const wallets = db.select().from(schema.cryptoWallets).orderBy(schema.cryptoWallets.id).all();
    const snap = computeSnapshot(accounts, wallets);
    const split = cryptoSplit(wallets);
    const change = netWorthChange(db, today(now), snap.totalCents);
    const walletRow = (w: (typeof wallets)[number]) => ({
      label: w.label || "Wallet",
      addressLast4: w.address.slice(-4),
      chain: w.chain,
      stableCents: w.stableUsdCents,
      volatileCents: w.volatileUsdCents,
      totalCents: w.totalUsdCents,
      updatedAt: iso(w.updatedAt),
    });
    return {
      asOf: iso(now),
      bankAccounts: accounts.map((a) => ({
        name: displayAccountName(a.name),
        last4: a.lastFour,
        type: a.type,
        balanceCents: a.balanceLedgerCents,
        availableCents: a.balanceAvailableCents,
        updatedAt: iso(a.balanceUpdatedAt),
        note: a.type === "credit" ? "Credit card: the balance is debt and is subtracted from net worth" : undefined,
      })),
      savingsWallets: wallets.filter((w) => w.role !== "trading").map((w) => ({ ...walletRow(w), counted: true })),
      tradingWallets: wallets
        .filter((w) => w.role === "trading")
        .map((w) => ({ ...walletRow(w), counted: false, note: "Memecoin trading wallet, treated as already spent, not counted" })),
      totals: {
        checkingCents: checkingCents(accounts),
        bankCashCents: bankCashCents(accounts),
        bankNetCents: snap.bankCents,
        cryptoStableCents: split.stableCents,
        cryptoVolatileCents: split.volatileCents,
        netWorthCents: snap.totalCents,
        tradingNotCountedCents: split.tradingCents,
        netWorthChange1dCents: change.change1dCents,
        netWorthChange30dCents: change.change30dCents,
      },
    };
  },
});

const listTransactions = def({
  name: "list_transactions",
  title: "List transactions",
  description:
    "Transactions in a date range, newest first. Negative amounts are money out. Filter by category name, free-text search, account (name or last four) and direction.",
  input: {
    start: dateArg("start"),
    end: dateArg("end"),
    category: z.string().max(60).optional().describe('Category name, or "Uncategorized"'),
    search: z.string().max(100).optional().describe("Words to look for in the description or merchant"),
    account: z.string().max(60).optional().describe("Account name or last four digits"),
    direction: z.enum(["in", "out"]).optional().describe("in = money received, out = money spent"),
    limit: z.number().int().min(1).max(500).default(50),
  },
  run: ({ db }, a) => {
    checkRange(a.start, a.end);
    const category = a.category
      ? ["uncategorized", "none"].includes(a.category.trim().toLowerCase())
        ? "none"
        : String(findCategory(db, a.category).id)
      : "";
    const f: TxFilters = {
      q: a.search ?? "",
      account: a.account ? findAccount(db, a.account).id : "",
      category,
      from: a.start,
      to: a.end,
      dir: a.direction ?? "",
      pending: false,
      merchant: "",
    };
    const r = queryTransactions(db, f, 1, a.limit);
    return { start: a.start, end: a.end, totalMatches: r.total, returned: r.rows.length, transactions: r.rows.map(txOut) };
  },
});

const spendingByCategory = def({
  name: "spending_by_category",
  title: "Spending by category",
  description: "Spending per category for a date range. Excludes transfers and income, net of refunds. Trading wallet funding shows as Memecoin trading.",
  input: { start: dateArg("start"), end: dateArg("end") },
  run: ({ db }, a) => {
    checkRange(a.start, a.end);
    const rows = categorySpend(db, a.start, a.end);
    const total = rows.reduce((s, r) => s + r.cents, 0);
    return {
      start: a.start,
      end: a.end,
      totalCents: total,
      categories: rows.map((r) => ({ category: r.name, spentCents: r.cents, sharePct: total ? Math.round((r.cents / total) * 1000) / 10 : 0 })),
    };
  },
});

const spendingByMerchant = def({
  name: "spending_by_merchant",
  title: "Spending by merchant",
  description: "Top merchants by spending for a date range, optionally within one category.",
  input: {
    start: dateArg("start"),
    end: dateArg("end"),
    category: z.string().max(60).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  },
  run: ({ db }, a) => {
    checkRange(a.start, a.end);
    const where = ["t.date >= ?", "t.date <= ?", "COALESCE(c.kind, 'expense') = 'expense'"];
    const params: (string | number)[] = [a.start, a.end];
    if (a.category) {
      if (["uncategorized", "none"].includes(a.category.trim().toLowerCase())) where.push("t.category_id IS NULL");
      else {
        where.push("t.category_id = ?");
        params.push(findCategory(db, a.category).id);
      }
    }
    const rows = db.$client
      .prepare(
        `SELECT COALESCE(t.merchant_key, 'unknown') AS merchant, SUM(-t.amount_cents) AS cents, COUNT(*) AS n
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${where.join(" AND ")} GROUP BY merchant HAVING cents > 0 ORDER BY cents DESC, merchant ASC LIMIT ?`,
      )
      .all(...params, a.limit) as { merchant: string; cents: number; n: number }[];
    return {
      start: a.start,
      end: a.end,
      category: a.category ?? null,
      merchants: rows.map((r) => ({ merchant: shortText(r.merchant, 40), spentCents: r.cents, transactions: r.n, avgTicketCents: Math.round(r.cents / r.n) })),
    };
  },
});

const comparePeriods = def({
  name: "compare_periods",
  title: "Compare two periods",
  description: "Per-category spending in period A versus period B, with change (B minus A). Good for month versus month.",
  input: { a_start: dateArg("a_start"), a_end: dateArg("a_end"), b_start: dateArg("b_start"), b_end: dateArg("b_end") },
  run: ({ db }, a) => {
    checkRange(a.a_start, a.a_end);
    checkRange(a.b_start, a.b_end);
    const A = new Map(categorySpend(db, a.a_start, a.a_end).map((r) => [r.name, r.cents]));
    const B = new Map(categorySpend(db, a.b_start, a.b_end).map((r) => [r.name, r.cents]));
    const names = new Set([...A.keys(), ...B.keys()]);
    const rows = [...names]
      .map((name) => {
        const x = A.get(name) ?? 0;
        const y = B.get(name) ?? 0;
        return { category: name, aCents: x, bCents: y, changeCents: y - x, changePct: x > 0 ? Math.round(((y - x) / x) * 100) : null };
      })
      .sort((p, q) => Math.abs(q.changeCents) - Math.abs(p.changeCents) || p.category.localeCompare(q.category));
    const ta = [...A.values()].reduce((s, v) => s + v, 0);
    const tb = [...B.values()].reduce((s, v) => s + v, 0);
    return {
      periodA: { start: a.a_start, end: a.a_end },
      periodB: { start: a.b_start, end: a.b_end },
      totals: { aCents: ta, bCents: tb, changeCents: tb - ta, changePct: ta > 0 ? Math.round(((tb - ta) / ta) * 100) : null },
      categories: rows,
    };
  },
});

const cashFlowTool = def({
  name: "cash_flow",
  title: "Cash flow",
  description: "Money in, money out and net for a date range. Transfers between own accounts are excluded; savings transfers and trading wallet flows are shown separately.",
  input: { start: dateArg("start"), end: dateArg("end") },
  run: ({ db }, a) => {
    checkRange(a.start, a.end);
    const f = cashFlow(db, a.start, a.end);
    const t = tradingFlows(db, a.start, a.end);
    const s = savingsTransfers(db, a.start, a.end);
    return {
      start: a.start,
      end: a.end,
      inCents: f.inCents,
      outCents: f.outCents,
      netCents: f.inCents - f.outCents,
      spendingCents: spendBetween(db, a.start, a.end),
      savingsTransfersCents: s.cents,
      savingsTransferCount: s.count,
      tradingFundedCents: t.fundedCents,
      tradingRealizedCents: t.realizedCents,
    };
  },
});

const listRecurring = def({
  name: "list_recurring_charges",
  title: "Recurring charges and bills",
  description: "Detected bills and subscriptions with cadence, typical amount (negative = out), next date, and flags for new or price-raised ones. Also recurring income.",
  run: ({ db, now }) => {
    const v = loadBills(db, today(now));
    const dueSoon = new Set(v.dueSoon.map((b) => b.merchantKey));
    const item = (b: (typeof v.items)[number]) => ({
      name: shortText(b.name, 60),
      cadence: b.cadence,
      amountCents: b.avgAmountCents,
      variableAmount: b.variableAmount,
      nextDate: b.nextDate,
      daysUntil: b.daysUntil,
      dueWithin7Days: dueSoon.has(b.merchantKey),
      subscription: b.isSubscription,
      priceRaised: b.priceUp,
      priceRaisedPct: b.priceUpPct,
      newThisMonth: b.isNew,
      userAdded: b.manual,
    });
    return { monthlyTotalCents: v.monthlyTotalCents, charges: v.items.map(item), recurringIncome: v.income.map(item), hiddenByOwner: v.ignored.length };
  },
});

const forecastMonthEnd = def({
  name: "forecast_month_end",
  title: "Forecast to month end",
  description: "Projected checking balance through the end of the month: recurring bills and expected income, plus typical daily spending. Shows the lowest point and any dip below the buffer.",
  run: ({ db, now }) => {
    const t = today(now);
    const buffer = db.select().from(schema.settings).get()?.bufferCents ?? 5000;
    const p = loadForecast(db, t, buffer);
    return {
      today: t,
      monthEnd: monthEnd(t),
      startCents: p.startCents,
      projectedEndCents: p.endCents,
      lowestCents: p.lowestCents,
      lowestDate: p.lowestDate,
      nextIncomeDate: p.nextIncomeDate,
      nextIncomeCents: p.nextIncomeCents,
      bufferCents: buffer,
      dipsBelowBuffer: p.warn,
      dipsBelowBufferOn: p.warnDate,
    };
  },
});

const syncStatus = def({
  name: "sync_status",
  title: "Sync status",
  description: "How fresh the data is: bank connection state, last sync time, recent sync runs, and the daily request budget. Read-only, it never starts a sync.",
  run: ({ db, now }) => {
    const conn = db.select().from(schema.connections).orderBy(schema.connections.id).limit(1).get();
    const runs = db.select().from(schema.syncRuns).orderBy(schema.syncRuns.id).all().slice(-5).reverse();
    const wallets = db.select().from(schema.cryptoWallets).all();
    return {
      connection: conn
        ? { provider: conn.provider, institution: conn.institutionName, status: conn.status, lastSyncedAt: iso(conn.lastSyncedAt), lastError: safeError(conn.lastError) }
        : null,
      syncRunning: isSyncRunning(),
      requestsLast24h: requestsInLast24h(db, now),
      dailyRequestBudget: DAILY_REQUEST_BUDGET,
      recentRuns: runs.map((r) => ({ trigger: r.trigger, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt), ok: r.ok, error: safeError(r.error) })),
      walletsWithErrors: wallets.filter((w) => w.lastError).length,
      walletsUpdatedAt: iso(wallets.reduce<number | null>((m, w) => (w.updatedAt !== null && (m === null || w.updatedAt > m) ? w.updatedAt : m), null)),
    };
  },
});

const safeToSpendTool = def({
  name: "safe_to_spend",
  title: "Safe to spend",
  description: "Money in checking that is free to spend today: checking minus bills due before the next income, minus the buffer, minus any unmet savings suggestion. Can be negative.",
  run: ({ db, now }) => {
    const s = safeToSpend(db, now);
    return {
      safeToSpendCents: s.safeCents,
      checkingCents: s.checkingCents,
      bufferCents: s.bufferCents,
      pendingSaveCents: s.pendingSaveCents,
      nextIncomeDate: s.nextIncomeDate,
      nextIncomeEstimateCents: s.nextIncomeEstCents,
      billsBeforeIncome: s.billsBeforeIncome.map((b) => ({ name: shortText(b.name, 60), date: b.date, amountCents: b.amountCents })),
    };
  },
});

const canAffordTool = def({
  name: "can_afford",
  title: "Can I afford this?",
  description: "Checks whether a purchase fits: against safe-to-spend and against the projected balance (overdraw check). Amount is positive dollars. Optional date for a future purchase.",
  input: { amount: z.number().positive().max(10_000_000).describe("Dollars, positive"), date: dateArg("date").optional() },
  run: ({ db, now }, a) => {
    const cents = Math.round(a.amount * 100);
    const t = today(now);
    if (a.date && a.date > shiftDays(t, 400)) throw new ToolError("date is too far ahead");
    const r = canAfford(db, cents, a.date, now);
    return {
      affordable: r.ok,
      amountCents: cents,
      date: a.date && a.date > t ? a.date : t,
      safeAfterCents: r.safeAfterCents,
      projectedLowCents: r.projectedLowCents,
      projectedLowDate: r.projectedLowDate,
      reason: r.reason,
    };
  },
});

const savePlan = def({
  name: "save_plan",
  title: "Save plan",
  description: "How much to move to savings: the latest per-deposit suggestion, the weekly roll-up when pay arrives in many small deposits, and the savings goal pace.",
  run: ({ db, now }) => {
    const t = today(now);
    const s = latestSuggestion(db);
    const g = loadGoalProgress(db, t);
    const per = goalPerDepositCents(db, t);
    const settings = db.select().from(schema.settings).get();
    return {
      savePercent: settings?.savePercent ?? 20,
      latestSuggestion: s
        ? {
            depositDate: s.incomeDate,
            depositCents: s.depositCents,
            suggestedCents: s.suggestedCents,
            savedSoFarCents: s.fulfilledCents,
            stillToMoveCents: s.unmetCents,
            done: s.fulfilled,
            reason: s.reason,
          }
        : null,
      weeklyRollup: weeklyRollup(db, t),
      goal: g
        ? {
            name: g.name,
            pct: g.pct,
            toGoCents: g.toGoCents,
            status: g.status,
            requiredPerWeekCents: g.requiredPerWeekCents,
            actualPerWeekCents: g.actualPerWeekCents,
            behindPerWeekCents: g.behindPerWeekCents,
          }
        : null,
      goalPerDeposit: per ? { cents: per.cents, goal: per.goalName } : null,
    };
  },
});

const budgetsStatus = def({
  name: "budgets_status",
  title: "Budgets this month",
  description: "Each category budget: limit, spent so far this month, percent used, and pace versus how much of the month has passed (above 1 = running hot).",
  run: ({ db, now }) => {
    const t = today(now);
    return {
      month: t.slice(0, 7),
      budgets: loadBudgets(db, t).map((b) => ({
        category: b.name,
        limitCents: b.limitCents,
        spentCents: b.spentCents,
        pct: b.pct,
        pace: b.pace === null ? null : Math.round(b.pace * 100) / 100,
        status: b.status,
        monthElapsedPct: Math.round(b.fractionElapsed * 100),
      })),
    };
  },
});

const savingsGoalTool = def({
  name: "savings_goal",
  title: "Savings goal",
  description: "The one savings goal: target, saved so far (savings wallets only, trading never counts), date and whether the pace is on track.",
  run: ({ db, now }) => {
    const g = loadGoalProgress(db, today(now));
    if (!g) return { goal: null, message: "No savings goal set" };
    const row = getGoal(db);
    return {
      goal: {
        name: g.name,
        targetCents: g.targetCents,
        savedCents: g.currentCents,
        pct: g.pct,
        toGoCents: g.toGoCents,
        targetDate: g.targetDate,
        weeksLeft: g.weeksLeft,
        counts: row?.counts ?? g.counts,
        requiredPerWeekCents: g.requiredPerWeekCents,
        actualPerWeekCents: g.actualPerWeekCents,
        status: g.status,
        behindPerWeekCents: g.behindPerWeekCents,
      },
    };
  },
});

const getDigestData = def({
  name: "get_digest_data",
  title: "Daily digest data",
  description:
    "Everything for the morning digest in one call: yesterday's outflows, month so far versus usual, bills due, balances, net worth, forecast, safe to spend, budgets, goal. date defaults to today; a past date shifts only the calendar-based parts, balances stay current.",
  input: { date: dateArg("date").optional() },
  run: ({ db, now }, a) => {
    const t = today(now);
    let at = now;
    if (a.date) {
      if (a.date > t) throw new ToolError("date cannot be in the future");
      if (a.date < shiftDays(t, -365)) throw new ToolError("date is more than a year back");
      // Midday UTC is the same calendar day in Chicago all year.
      at = Date.parse(`${a.date}T18:00:00Z`);
    }
    const d = buildDigestData(db, at);
    return { ...d, connection: { ...d.connection, lastSyncedAt: iso(d.connection.lastSyncedAt), lastError: safeError(d.connection.lastError) } };
  },
});

const listCategories = def({
  name: "list_categories",
  title: "List categories",
  description: "All categories with their kind (expense, income, transfer) and whether they have a monthly budget. Use these exact names in other tools.",
  run: ({ db }) => {
    const budgeted = new Set(db.select().from(schema.budgets).all().map((b) => b.categoryId));
    return {
      categories: db
        .select()
        .from(schema.categories)
        .orderBy(schema.categories.name)
        .all()
        .map((c) => ({ name: c.name, kind: c.kind, hasBudget: budgeted.has(c.id) })),
    };
  },
});

const listRules = def({
  name: "list_rules",
  title: "List categorization rules",
  description: "Your category rules (pattern to category), highest priority first. Built-in default rules are hidden unless include_defaults is true.",
  input: { include_defaults: z.boolean().default(false) },
  run: ({ db }, a) => {
    const cats = new Map(db.select().from(schema.categories).all().map((c) => [c.id, c.name]));
    const rows = db
      .select()
      .from(schema.rules)
      .all()
      .filter((r) => a.include_defaults || !r.isDefault)
      .sort((x, y) => y.priority - x.priority || x.id - y.id);
    return {
      count: rows.length,
      rules: rows.map((r) => ({
        id: r.id,
        pattern: shortText(r.pattern, 100),
        matchType: r.matchType,
        field: r.field,
        direction: r.direction,
        amountMinCents: r.amountMinCents,
        amountMaxCents: r.amountMaxCents,
        category: cats.get(r.categoryId) ?? "?",
        priority: r.priority,
        enabled: r.enabled,
        builtIn: r.isDefault,
      })),
    };
  },
});

// ---------- digest write ----------

const publishDigestTool = def({
  name: "publish_digest",
  title: "Publish the daily digest",
  description:
    "Posts your written digest (markdown, 4000 characters max) to the app, which stores it for the day and pushes a notification to the owner's phone. Posting again for the same day replaces it.",
  kind: "digest",
  readOnly: false,
  idempotent: true,
  input: { markdown: z.string().min(1).max(4000), date: dateArg("date").optional() },
  run: async ({ db, now }, a) => {
    const t = today(now);
    const day = a.date ?? t;
    if (day > t) throw new ToolError("date cannot be in the future");
    if (day < shiftDays(t, -7)) throw new ToolError("date is more than a week back");
    const r = await publishDigest(day, a.markdown, "claude", { db, now });
    return { stored: r.stored, date: day, push: r.push };
  },
});

// ---------- write tools ----------

const recategorize = def({
  name: "recategorize_transaction",
  title: "Recategorize a transaction",
  description: "Sets one transaction's category by hand. It sticks: sync and rules never override a manual category.",
  kind: "write",
  readOnly: false,
  idempotent: true,
  input: { transaction_id: z.string().min(1).max(200), category: z.string().min(1).max(60) },
  run: ({ db, now }, a) => {
    const tx = getTransaction(db, a.transaction_id);
    if (!tx) throw new ToolError("No transaction with that id");
    const cat = findCategory(db, a.category);
    db.update(schema.transactions).set({ categoryId: cat.id, categorySource: "manual", updatedAt: now }).where(eq(schema.transactions.id, tx.id)).run();
    rebuildRecurring(db, today(now));
    return { updated: txOut(getTransaction(db, tx.id)!), previousCategory: tx.categoryName ?? "Uncategorized" };
  },
});

const MAX_RULES = 500;

const createRule = def({
  name: "create_rule",
  title: "Create a categorization rule",
  description:
    "Adds a rule that puts matching transactions in a category (never overrides manual ones). pattern is plain text unless match_type is regex (max 100 chars, no nested repeats). Returns how many transactions matched. Creating the same rule twice returns the existing one.",
  kind: "write",
  readOnly: false,
  idempotent: true,
  input: {
    pattern: z.string().min(1).max(200),
    category: z.string().min(1).max(60),
    field: z.enum(["description", "counterparty", "any"]).default("any"),
    match_type: z.enum(["contains", "equals", "regex"]).default("contains"),
    direction: z.enum(["out", "in", "any"]).default("out").describe("out = money spent, in = money received"),
    amount_min: z.number().min(0).max(10_000_000).optional().describe("Dollars, applies to the absolute amount"),
    amount_max: z.number().min(0).max(10_000_000).optional(),
    apply_now: z.boolean().default(true),
  },
  run: ({ db, now }, a) => {
    const pattern = a.pattern.trim();
    if (!pattern) throw new ToolError("Pattern is empty");
    if (a.match_type === "regex") {
      const problem = regexProblem(pattern);
      if (problem) throw new ToolError(problem);
    }
    const min = a.amount_min === undefined ? null : Math.round(a.amount_min * 100);
    const max = a.amount_max === undefined ? null : Math.round(a.amount_max * 100);
    if (min !== null && max !== null && min > max) throw new ToolError("amount_min is above amount_max");
    const cat = findCategory(db, a.category);

    const existing = db
      .select()
      .from(schema.rules)
      .where(and(eq(schema.rules.categoryId, cat.id), eq(schema.rules.field, a.field), eq(schema.rules.matchType, a.match_type), eq(schema.rules.direction, a.direction)))
      .all()
      .find((r) => r.pattern.toLowerCase() === pattern.toLowerCase() && r.amountMinCents === min && r.amountMaxCents === max);
    const probe = {
      field: a.field,
      matchType: a.match_type,
      direction: a.direction,
      pattern,
      amountMinCents: min,
      amountMaxCents: max,
      categoryId: cat.id,
      priority: 100,
    } as const;
    if (existing) {
      return { ruleId: existing.id, alreadyExisted: true, matched: previewRule(db, { ...probe, priority: existing.priority }).count, recategorized: null };
    }
    if (db.select().from(schema.rules).all().length >= MAX_RULES) throw new ToolError("Too many rules already");
    const row = db.insert(schema.rules).values({ ...probe, createdAt: now }).returning({ id: schema.rules.id }).get();
    const matched = previewRule(db, probe).count;
    const changed = a.apply_now ? applyRuleChange(db, now).changed : null;
    return { ruleId: row.id, alreadyExisted: false, category: cat.name, matched, recategorized: changed };
  },
});

const setBudgetTool = def({
  name: "set_budget",
  title: "Set a monthly budget",
  description: "Sets the monthly spending limit (dollars) for an expense category, replacing any existing limit.",
  kind: "write",
  readOnly: false,
  idempotent: true,
  input: { category: z.string().min(1).max(60), monthly_limit: z.number().positive().max(1_000_000) },
  run: ({ db, now }, a) => {
    const cat = findCategory(db, a.category);
    if (cat.kind !== "expense") throw new ToolError("Budgets are only for expense categories");
    const cents = Math.round(a.monthly_limit * 100);
    setBudget(db, cat.id, cents, now);
    return { category: cat.name, monthlyLimitCents: cents };
  },
});

export const TOOLS: ToolDef[] = [
  getBalances,
  listTransactions,
  spendingByCategory,
  spendingByMerchant,
  comparePeriods,
  cashFlowTool,
  listRecurring,
  forecastMonthEnd,
  syncStatus,
  safeToSpendTool,
  canAffordTool,
  savePlan,
  budgetsStatus,
  savingsGoalTool,
  getDigestData,
  listCategories,
  listRules,
  publishDigestTool,
  recategorize,
  createRule,
  setBudgetTool,
];
