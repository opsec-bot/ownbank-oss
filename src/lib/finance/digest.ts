import { eq } from "drizzle-orm";
import { localDate } from "@/lib/bank/normalize";
import { getDb, schema, type DB } from "@/lib/db";
import { notify, type NotifyStatus } from "@/lib/push/send";
import { safeToSpend } from "./afford";
import { loadBills } from "./bills";
import { addMonthsStart, sameDayInMonth, shiftDays, monthStart } from "./dates";
import { loadBudgets, type BudgetStatus } from "./budgets";
import { checkingCents, bankCashCents, loadForecast } from "./forecast";
import { loadGoalProgress, type GoalProgress } from "./goal";
import { merchantName } from "./merchant-name";
import { cryptoSplit, displayAccountName, formatCents } from "./networth";
import { latestSuggestion } from "./save-plan";
import { categorySpend, earliestTxDate, savingsTransfers, spendBetween, tradingFlows } from "./stats";
import { computeSnapshot, netWorthChange } from "./snapshots";

export const OVER_AVERAGE_FLAG = 0.25;

export type DigestData = {
  date: string;
  yesterday: {
    date: string;
    outflowCents: number;
    top: { merchantKey: string; amountCents: number; category: string }[];
  };
  month: { spendCents: number; lastMonthSamePointCents: number };
  categories: { name: string; mtdCents: number; avg3mCents: number | null; overPct: number | null; flagged: boolean }[];
  billsDue: { name: string; date: string; amountCents: number }[];
  subscriptions: { newItems: { name: string; amountCents: number }[]; raised: { name: string; pct: number }[] };
  balances: {
    accounts: { name: string; lastFour: string | null; type: string | null; balanceCents: number | null }[];
    checkingCents: number;
    bankCashCents: number;
  };
  netWorth: { totalCents: number; change1dCents: number | null; change30dCents: number | null };
  savings: { stableCents: number; volatileCents: number; tradingCents: number };
  savingsTransfersMtd: { count: number; cents: number };
  trading: { fundedMtdCents: number; realizedMtdCents: number };
  forecast: {
    projectedEndCents: number;
    lowestCents: number;
    lowestDate: string;
    lowBalance: boolean;
    lowBalanceDate: string | null;
    nextIncomeDate: string | null;
  };
  safeToSpend: { safeCents: number; bufferCents: number; pendingSaveCents: number };
  saveSuggestion: { depositCents: number; suggestedCents: number; fulfilled: boolean } | null;
  budgets: { category: string; spentCents: number; limitCents: number; pct: number; pace: number | null; status: BudgetStatus }[];
  goal: {
    name: string;
    targetCents: number;
    currentCents: number;
    pct: number;
    toGoCents: number;
    targetDate: string | null;
    requiredPerWeekCents: number | null;
    actualPerWeekCents: number;
    status: GoalProgress["status"];
    behindPerWeekCents: number;
  } | null;
  connection: { status: "active" | "broken" | "none"; lastSyncedAt: number | null; lastError: string | null; walletErrors: number };
};

export function buildDigestData(db: DB, now: number): DigestData {
  const today = localDate(Math.floor(now / 1000));
  const yDate = shiftDays(today, -1);
  const start = monthStart(today);

  // Yesterday's outflows (expense kinds only), top five by size.
  const yRows = db.$client
    .prepare(
      `SELECT COALESCE(t.merchant_key, 'unknown') AS merchantKey, -t.amount_cents AS amountCents,
              COALESCE(c.name, 'Uncategorized') AS category
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.date = ? AND t.amount_cents < 0 AND COALESCE(c.kind, 'expense') = 'expense'
       ORDER BY t.amount_cents ASC, t.id ASC`,
    )
    .all(yDate) as { merchantKey: string; amountCents: number; category: string }[];
  const yFlows = tradingFlows(db, yDate, yDate).fundedCents;

  // Per-category MTD vs the average of the same point (same day of month) in each of the last 3 months,
  // counting only months the transaction history fully covers.
  const mtdCats = categorySpend(db, start, today);
  const earliest = earliestTxDate(db);
  const past: Map<string, number>[] = [];
  for (let k = 1; k <= 3; k++) {
    const mStart = addMonthsStart(today, -k);
    if (earliest === null || mStart < earliest) continue;
    past.push(new Map(categorySpend(db, mStart, sameDayInMonth(today, -k)).map((c) => [c.name, c.cents])));
  }
  const names = new Set<string>(mtdCats.map((c) => c.name));
  for (const m of past) for (const n of m.keys()) names.add(n);
  const mtdByName = new Map(mtdCats.map((c) => [c.name, c.cents]));
  const categories = [...names]
    .map((name) => {
      const mtd = mtdByName.get(name) ?? 0;
      const avg = past.length ? Math.round(past.reduce((s, m) => s + (m.get(name) ?? 0), 0) / past.length) : null;
      const over = avg !== null && avg > 0 ? Math.round(((mtd - avg) / avg) * 100) : null;
      return { name, mtdCents: mtd, avg3mCents: avg, overPct: over, flagged: avg !== null && avg > 0 && mtd > avg * (1 + OVER_AVERAGE_FLAG) };
    })
    .filter((c) => c.mtdCents > 0 || (c.avg3mCents ?? 0) > 0)
    .sort((a, b) => b.mtdCents - a.mtdCents || a.name.localeCompare(b.name));

  const bills = loadBills(db, today);
  const accounts = db.select().from(schema.accounts).orderBy(schema.accounts.name).all().filter((a) => !a.hidden);
  const wallets = db.select().from(schema.cryptoWallets).orderBy(schema.cryptoWallets.id).all();
  const snap = computeSnapshot(accounts, wallets);
  const change = netWorthChange(db, today, snap.totalCents);
  const split = cryptoSplit(wallets);
  const forecast = loadForecast(db, today, db.select().from(schema.settings).get()?.bufferCents ?? 5000);
  const safe = safeToSpend(db, now);
  const sug = latestSuggestion(db);
  const conn = db.select().from(schema.connections).orderBy(schema.connections.id).limit(1).get();
  const t = tradingFlows(db, start, today);
  const goal = loadGoalProgress(db, today);

  return {
    date: today,
    yesterday: {
      date: yDate,
      outflowCents: yRows.reduce((s, r) => s + r.amountCents, 0) + yFlows,
      top: yRows.slice(0, 5),
    },
    month: {
      spendCents: spendBetween(db, start, today),
      lastMonthSamePointCents: spendBetween(db, addMonthsStart(today, -1), sameDayInMonth(today, -1)),
    },
    categories,
    billsDue: bills.dueSoon.map((b) => ({ name: b.name, date: b.nextDate ?? "", amountCents: -b.avgAmountCents })),
    subscriptions: {
      newItems: bills.items.filter((b) => b.isNew).map((b) => ({ name: b.name, amountCents: -b.avgAmountCents })),
      raised: bills.items.filter((b) => b.priceUp).map((b) => ({ name: b.name, pct: b.priceUpPct ?? 0 })),
    },
    balances: {
      accounts: accounts.map((a) => ({
        name: displayAccountName(a.name),
        lastFour: a.lastFour,
        type: a.type,
        balanceCents: a.balanceLedgerCents,
      })),
      checkingCents: checkingCents(accounts),
      bankCashCents: bankCashCents(accounts),
    },
    netWorth: { totalCents: snap.totalCents, change1dCents: change.change1dCents, change30dCents: change.change30dCents },
    savings: { stableCents: split.stableCents, volatileCents: split.volatileCents, tradingCents: split.tradingCents },
    savingsTransfersMtd: savingsTransfers(db, start, today),
    trading: { fundedMtdCents: t.fundedCents, realizedMtdCents: t.realizedCents },
    forecast: {
      projectedEndCents: forecast.endCents,
      lowestCents: forecast.lowestCents,
      lowestDate: forecast.lowestDate,
      lowBalance: forecast.warn,
      lowBalanceDate: forecast.warnDate,
      nextIncomeDate: forecast.nextIncomeDate,
    },
    safeToSpend: { safeCents: safe.safeCents, bufferCents: safe.bufferCents, pendingSaveCents: safe.pendingSaveCents },
    saveSuggestion: sug
      ? { depositCents: sug.depositCents, suggestedCents: sug.suggestedCents, fulfilled: sug.fulfilled }
      : null,
    budgets: loadBudgets(db, today).map((b) => ({
      category: b.name,
      spentCents: b.spentCents,
      limitCents: b.limitCents,
      pct: b.pct,
      pace: b.pace === null ? null : Math.round(b.pace * 100) / 100,
      status: b.status,
    })),
    goal: goal
      ? {
          name: goal.name,
          targetCents: goal.targetCents,
          currentCents: goal.currentCents,
          pct: goal.pct,
          toGoCents: goal.toGoCents,
          targetDate: goal.targetDate,
          requiredPerWeekCents: goal.requiredPerWeekCents,
          actualPerWeekCents: goal.actualPerWeekCents,
          status: goal.status,
          behindPerWeekCents: goal.behindPerWeekCents,
        }
      : null,
    connection: {
      status: conn ? conn.status : "none",
      lastSyncedAt: conn?.lastSyncedAt ?? null,
      lastError: conn?.lastError ?? null,
      walletErrors: wallets.filter((w) => w.lastError).length,
    },
  };
}

function signed(cents: number | null): string {
  if (cents === null) return "n/a";
  return `${cents >= 0 ? "+" : "-"}${formatCents(Math.abs(cents))}`;
}

// Plain numbers-only fallback digest (markdown bullet lines). Used when Claude has not posted one.
export function renderAutoDigest(d: DigestData): string {
  const lines: string[] = [];
  lines.push(`Digest for ${d.date}`);
  lines.push("");
  lines.push(`- Yesterday: ${formatCents(d.yesterday.outflowCents)} out`);
  for (const t of d.yesterday.top) lines.push(`  - ${merchantName(t.merchantKey)}: ${formatCents(t.amountCents)} (${t.category})`);
  lines.push(`- Spent this month: ${formatCents(d.month.spendCents)} vs ${formatCents(d.month.lastMonthSamePointCents)} same point last month`);
  const flagged = d.categories.filter((c) => c.flagged);
  for (const c of flagged) {
    lines.push(`- ${c.name}: ${formatCents(c.mtdCents)} this month, ${c.overPct}% over its usual ${formatCents(c.avg3mCents ?? 0)}`);
  }
  if (d.billsDue.length) {
    lines.push(`- Due in 7 days: ${d.billsDue.map((b) => `${merchantName(b.name)} ${formatCents(b.amountCents)} on ${b.date}`).join("; ")}`);
  } else lines.push("- Nothing due in the next 7 days");
  for (const n of d.subscriptions.newItems) lines.push(`- New recurring charge: ${merchantName(n.name)} ${formatCents(n.amountCents)}`);
  for (const r of d.subscriptions.raised) lines.push(`- Price up ${r.pct}%: ${merchantName(r.name)}`);
  lines.push(`- Checking: ${formatCents(d.balances.checkingCents)}, safe to spend ${formatCents(d.safeToSpend.safeCents)}`);
  lines.push(
    `- Net worth: ${formatCents(d.netWorth.totalCents)} (1d ${signed(d.netWorth.change1dCents)}, 30d ${signed(d.netWorth.change30dCents)})`,
  );
  lines.push(`- Savings: ${formatCents(d.savings.stableCents)} stable, ${formatCents(d.savings.volatileCents)} volatile`);
  if (d.savingsTransfersMtd.count > 0) {
    lines.push(`- Moved to savings this month: ${formatCents(d.savingsTransfersMtd.cents)} (${d.savingsTransfersMtd.count} transfers)`);
  }
  if (d.trading.fundedMtdCents || d.trading.realizedMtdCents) {
    lines.push(`- Memecoin this month: -${formatCents(d.trading.fundedMtdCents)} funded, +${formatCents(d.trading.realizedMtdCents)} realized`);
  }
  lines.push(
    `- Month-end projection: ${formatCents(d.forecast.projectedEndCents)}${d.forecast.lowBalance ? `, LOW: dips under buffer on ${d.forecast.lowBalanceDate}` : ""}`,
  );
  for (const b of d.budgets) {
    if (b.status === "ok") continue;
    lines.push(
      `- Budget ${b.category}: ${formatCents(b.spentCents)} of ${formatCents(b.limitCents)} (${b.pct}%)${b.status === "over" ? ", over the limit" : ", ahead of pace"}`,
    );
  }
  if (d.goal) {
    const g = d.goal;
    const tail =
      g.status === "behind"
        ? `, behind by ${formatCents(g.behindPerWeekCents)}/week`
        : g.status === "on_track"
          ? ", on track"
          : g.status === "reached"
            ? ", reached"
            : g.status === "past_due"
              ? ", past its date"
              : "";
    lines.push(`- Goal ${g.name}: ${formatCents(g.currentCents)} of ${formatCents(g.targetCents)} (${g.pct}%)${tail}`);
  }
  if (d.connection.status !== "active") lines.push(`- Bank connection: ${d.connection.status}`);
  return lines.join("\n");
}

// First 2-3 plain lines of a digest for a push body: top-level lines only, markdown marks stripped, the heading line
// ("Digest for <date>") skipped.
export function digestPushBody(markdown: string): string {
  const lines: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    if (!raw.trim() || /^\s/.test(raw)) continue;
    const t = raw
      .trim()
      .replace(/^(#{1,6}|[-*+])\s+/, "")
      .replace(/[*_`]/g, "")
      .trim();
    if (!t || /^digest for /i.test(t)) continue;
    lines.push(t);
    if (lines.length === 3) break;
  }
  const body = lines.join("\n");
  return body.length > 240 ? `${body.slice(0, 237)}...` : body;
}

export type PublishResult = { stored: true; push: NotifyStatus };

// Stores the digest for a day and pushes it. Claude posts source "claude" (the step 6 MCP tool calls this); the
// 8:15 AM fallback posts "auto". An auto digest never replaces a Claude one. If an auto digest already went out today
// and Claude's arrives later, the push says so instead of repeating the numbers.
export async function publishDigest(
  day: string,
  markdown: string,
  source: "claude" | "auto",
  opts: { db?: DB; now?: number } = {},
): Promise<PublishResult> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? Date.now();
  const prev = db.select().from(schema.digests).where(eq(schema.digests.day, day)).get();
  if (prev?.source === "claude" && source === "auto") return { stored: true, push: "duplicate" };
  db.insert(schema.digests)
    .values({ day, source, bodyMd: markdown, createdAt: now })
    .onConflictDoUpdate({ target: schema.digests.day, set: { source, bodyMd: markdown, createdAt: now } })
    .run();
  const laterThanAuto = source === "claude" && prev?.source === "auto";
  const push = await notify(
    db,
    {
      kind: "digest",
      title: laterThanAuto ? "Claude's digest is ready" : "Today",
      body: digestPushBody(markdown),
      url: "/digest",
      tag: "digest",
      key: `digest:${source}:${day}`,
    },
    { now },
  );
  return { stored: true, push };
}
