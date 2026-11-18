import { eq, inArray } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { budgetAlerts, loadBudgets } from "@/lib/finance/budgets";
import { shiftDays } from "@/lib/finance/dates";
import { loadForecast } from "@/lib/finance/forecast";
import { highestMilestone, loadGoalProgress } from "@/lib/finance/goal";
import { merchantName } from "@/lib/finance/merchant-name";
import { formatCents } from "@/lib/finance/networth";
import { safeToSpend } from "@/lib/finance/afford";
import { notify, type Sender, type VapidDetails } from "./send";
import { chicagoParts } from "./time";

// Alert triggers. Each one builds the message and hands it to notify(), which dedupes by key, honors the per-kind toggle
// and quiet hours. Nothing here throws into the caller: the sync engine wraps runSyncTriggers in a try/catch too.

type Opts = { now?: number; sender?: Sender; vapid?: VapidDetails | null };

export const LARGE_TX_MAX_AGE_DAYS = 7; // only recent first-seen rows (a backfill is not news)
const LARGE_TX_INDIVIDUAL_MAX = 3; // more than this in one sync: one combined push

function shortDate(d: string): string {
  return `${d.slice(5, 7)}/${d.slice(8, 10)}`;
}

// ---------- income -> save ----------

export async function incomeSaveTrigger(db: DB, incomeTxIds: string[], opts: Opts = {}) {
  if (incomeTxIds.length === 0) return;
  const rows = db
    .select({ id: schema.transactions.id, amountCents: schema.transactions.amountCents, suggested: schema.saveSuggestions.suggestedCents, reason: schema.saveSuggestions.reason })
    .from(schema.saveSuggestions)
    .innerJoin(schema.transactions, eq(schema.transactions.id, schema.saveSuggestions.incomeTxId))
    .where(inArray(schema.saveSuggestions.incomeTxId, incomeTxIds))
    .all();
  if (rows.length === 0) return;
  const total = rows.reduce((s, r) => s + r.amountCents, 0);
  const save = rows.reduce((s, r) => s + r.suggested, 0);
  const ids = rows.map((r) => r.id).sort();
  const got = rows.length === 1 ? `Got ${formatCents(total)}` : `Got ${formatCents(total)} from ${rows.length} deposits`;
  const body =
    save > 0
      ? `${got} → move ${formatCents(save)} to savings`
      : `${got}. Nothing to move right now: ${rows[0].reason.charAt(0).toLowerCase()}${rows[0].reason.slice(1)}`;
  await notify(
    db,
    { kind: "income_save", title: save > 0 ? "Move to savings" : "Income landed", body, url: "/dashboard", tag: "income_save", key: `income_save:${ids[0]}:${ids.length}` },
    opts,
  );
}

// ---------- large transactions ----------

export async function largeTxTrigger(db: DB, txIds: string[], now: number, opts: Opts = {}) {
  if (txIds.length === 0) return;
  const cutoff = shiftDays(chicagoParts(now).day, -LARGE_TX_MAX_AGE_DAYS);
  const rows = db
    .select({
      id: schema.transactions.id,
      amountCents: schema.transactions.amountCents,
      date: schema.transactions.date,
      merchant: schema.transactions.merchantKey,
      kind: schema.categories.kind,
    })
    .from(schema.transactions)
    .leftJoin(schema.categories, eq(schema.categories.id, schema.transactions.categoryId))
    .where(inArray(schema.transactions.id, txIds))
    .all()
    // Outflows only, recent only, and not transfers (moving your own money is not a large purchase).
    .filter((r) => r.amountCents < 0 && r.date >= cutoff && r.kind !== "transfer")
    .sort((a, b) => a.amountCents - b.amountCents);
  if (rows.length === 0) return;
  if (rows.length > LARGE_TX_INDIVIDUAL_MAX) {
    const total = rows.reduce((s, r) => s - r.amountCents, 0);
    await notify(
      db,
      {
        kind: "large_tx",
        title: "Large transactions",
        body: `${rows.length} large charges, ${formatCents(total)} total`,
        url: "/transactions",
        tag: "large_tx",
        key: `large_tx:batch:${rows.map((r) => r.id).sort()[0]}:${rows.length}`,
      },
      { ...opts, now },
    );
    return;
  }
  for (const r of rows) {
    await notify(
      db,
      {
        kind: "large_tx",
        title: "Large transaction",
        body: `${formatCents(-r.amountCents)} at ${merchantName(r.merchant)}`,
        url: "/transactions",
        tag: `large_tx:${r.id}`,
        key: `large_tx:${r.id}`,
      },
      { ...opts, now },
    );
  }
}

// ---------- low balance ----------

// Checking projected under the buffer before the next income. At most once per day (key carries the Chicago date).
export async function lowBalanceTrigger(db: DB, now: number, opts: Opts = {}) {
  const today = chicagoParts(now).day;
  const buffer = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get()?.bufferCents ?? 5000;
  const f = loadForecast(db, today, buffer);
  if (!f.warn || !f.warnDate) return;
  const safe = safeToSpend(db, now);
  await notify(
    db,
    {
      kind: "low_balance",
      title: "Low balance ahead",
      body: `Checking is projected under ${formatCents(buffer)} on ${shortDate(f.warnDate)}${f.nextIncomeDate ? `, before income on ${shortDate(f.nextIncomeDate)}` : ""}. Safe to spend: ${formatCents(safe.safeCents)}`,
      url: "/dashboard",
      tag: "low_balance",
      key: `low_balance:${today}`,
    },
    { ...opts, now },
  );
}

// ---------- disconnect ----------

export async function disconnectTrigger(db: DB, connectionId: number, now: number, opts: Opts = {}) {
  await notify(
    db,
    {
      kind: "disconnect",
      title: "Bank connection broken",
      body: "Bank connection broken — tap to re-link",
      url: "/settings/bank#replace",
      tag: "disconnect",
      key: `disconnect:${connectionId}:${now}`,
    },
    { ...opts, now },
  );
}

// ---------- budgets ----------

export async function budgetTrigger(db: DB, now: number, opts: Opts = {}) {
  const today = chicagoParts(now).day;
  for (const a of budgetAlerts(loadBudgets(db, today), today)) {
    await notify(db, { kind: "budget_pace", title: a.title, body: a.body, url: "/spending", tag: a.key, key: a.key }, { ...opts, now });
  }
}

// ---------- goal milestones ----------

const ackKey = (createdAt: number) => `goal_milestone:${createdAt}`;

export function getAckedMilestone(db: DB, createdAt: number): number {
  const r = db.select().from(schema.appState).where(eq(schema.appState.key, ackKey(createdAt))).get();
  return r ? Number(r.value) || 0 : 0;
}

export function setAckedMilestone(db: DB, createdAt: number, pct: number) {
  db.insert(schema.appState)
    .values({ key: ackKey(createdAt), value: String(pct) })
    .onConflictDoUpdate({ target: schema.appState.key, set: { value: String(pct) } })
    .run();
}

// Called when a goal is created or its target changes: milestones already passed do not push.
export function baselineGoalMilestones(db: DB, now = Date.now()) {
  const g = db.select().from(schema.savingsGoal).where(eq(schema.savingsGoal.id, 1)).get();
  if (!g) return;
  const p = loadGoalProgress(db, chicagoParts(now).day);
  if (p) setAckedMilestone(db, g.createdAt, highestMilestone(p.pct));
}

export async function goalTrigger(db: DB, now: number, opts: Opts = {}) {
  const g = db.select().from(schema.savingsGoal).where(eq(schema.savingsGoal.id, 1)).get();
  if (!g) return;
  const p = loadGoalProgress(db, chicagoParts(now).day);
  if (!p) return;
  const m = highestMilestone(p.pct);
  if (m === 0 || m <= getAckedMilestone(db, g.createdAt)) return;
  await notify(
    db,
    {
      kind: "goal",
      title: m >= 100 ? "Goal reached" : `Goal ${m}%`,
      body:
        m >= 100
          ? `${p.name}: ${formatCents(p.currentCents)} saved, target ${formatCents(p.targetCents)}`
          : `${p.name}: ${m}% there, ${formatCents(p.toGoCents)} to go`,
      url: "/dashboard",
      tag: "goal",
      key: `goal:${g.createdAt}:${m}`,
    },
    { ...opts, now },
  );
  // Disabled toggle or duplicate: still record it so turning the toggle on later does not replay old milestones.
  setAckedMilestone(db, g.createdAt, m);
}

// ---------- everything after a sync ----------

export type SyncTriggerInput = { newIncomeTxIds: string[]; newLargeTxIds: string[] };

export async function runSyncTriggers(db: DB, stats: SyncTriggerInput, now: number, opts: Opts = {}) {
  const steps: [string, () => Promise<void>][] = [
    ["income", () => incomeSaveTrigger(db, stats.newIncomeTxIds, { ...opts, now })],
    ["large tx", () => largeTxTrigger(db, stats.newLargeTxIds, now, opts)],
    ["low balance", () => lowBalanceTrigger(db, now, opts)],
    ["budgets", () => budgetTrigger(db, now, opts)],
    ["goal", () => goalTrigger(db, now, opts)],
  ];
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (e) {
      console.error(`${name} alert failed:`, e instanceof Error ? e.message : "unknown error");
    }
  }
}
