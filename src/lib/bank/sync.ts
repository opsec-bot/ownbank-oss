import "server-only";
import { and, eq, gte, inArray, notInArray } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { getDb, schema, type DB } from "@/lib/db";
import { categorize, type RuleRow } from "@/lib/finance/categorize";
import { disconnectTrigger, runSyncTriggers } from "@/lib/push/triggers";
import { rebuildRecurring } from "@/lib/finance/recurring";
import { createSuggestionsForNew, updateFulfillment } from "@/lib/finance/save-plan";
import { writeSnapshot } from "@/lib/finance/snapshots";
import { localDate, merchantKey } from "./normalize";
import {
  SimpleFinError,
  extractLastFour,
  fetchAccounts as realFetchAccounts,
  guessAccountType,
  mergeResults,
  splitWindow,
  type SfResult,
} from "./simplefin";

export type SyncTrigger = "cron" | "open" | "webhook" | "manual";

export type SyncStats = {
  accounts: number;
  inserted: number;
  updated: number;
  removed: number;
  newLargeTxIds: string[];
  newIncomeTxIds: string[]; // new deposits that got a save suggestion
};

export type SyncOutcome =
  | { ok: true; stats: SyncStats }
  | { ok: false; skipped: string }
  | { ok: false; error: string };

export const WINDOW_DAYS = 30;
export const BACKFILL_DAYS = 90;
export const BACKFILL_MIN_HISTORY_DAYS = 60;
export const DAILY_REQUEST_BUDGET = 20; // SimpleFIN allows 24/day; stay under it.
const DAY_MS = 86_400_000;

// ---------- request budget ----------

export function requestsInLast24h(db: DB, now = Date.now()): number {
  const rows = db
    .select({ stats: schema.syncRuns.stats })
    .from(schema.syncRuns)
    .where(gte(schema.syncRuns.startedAt, now - DAY_MS))
    .all();
  let n = 0;
  for (const r of rows) {
    if (!r.stats) continue;
    try {
      const v = (JSON.parse(r.stats) as { requests?: unknown }).requests;
      if (typeof v === "number") n += v;
    } catch {
      // ignore malformed stats
    }
  }
  return n;
}

export function budgetAllows(db: DB, now = Date.now(), limit = DAILY_REQUEST_BUDGET): boolean {
  return requestsInLast24h(db, now) < limit;
}

// App-open trigger: only when the last successful sync is older than 60 minutes, the connection is healthy,
// and nothing was attempted in the last 10 minutes (so a failing fetch does not retry on every page view).
export function shouldOpenSync(db: DB, now = Date.now()): boolean {
  const conn = db.select().from(schema.connections).orderBy(schema.connections.id).limit(1).get();
  if (!conn || conn.status !== "active") return false;
  if (conn.lastSyncedAt !== null && now - conn.lastSyncedAt <= 60 * 60 * 1000) return false;
  const recent = db
    .select({ id: schema.syncRuns.id })
    .from(schema.syncRuns)
    .where(gte(schema.syncRuns.startedAt, now - 10 * 60 * 1000))
    .limit(1)
    .get();
  return !recent;
}

// One-time history backfill: due when no successful 90 day sync has happened and some account has under 60 days of
// transactions. The sync engine then uses a 90 day window for that one request instead of 30.
export function backfillDue(db: DB, now = Date.now()): boolean {
  const runs = db.select({ stats: schema.syncRuns.stats, ok: schema.syncRuns.ok }).from(schema.syncRuns).all();
  for (const r of runs) {
    if (!r.ok || !r.stats) continue;
    try {
      const w = (JSON.parse(r.stats) as { window?: unknown }).window;
      if (typeof w === "number" && w >= BACKFILL_DAYS) return false;
    } catch {
      // ignore malformed stats
    }
  }
  const cutoff = localDate(Math.floor(now / 1000) - BACKFILL_MIN_HISTORY_DAYS * 86400);
  const accts = db.select({ id: schema.accounts.id }).from(schema.accounts).all();
  if (accts.length === 0) return true;
  const stmt = db.$client.prepare(`SELECT MIN(date) AS d FROM transactions WHERE account_id = ?`);
  return accts.some((a) => {
    const d = (stmt.get(a.id) as { d: string | null }).d;
    return d === null || d > cutoff;
  });
}

// ---------- applying a fetched result to the database ----------

export function applySync(db: DB, connectionId: number, result: SfResult, now: number, windowStartUnix: number): SyncStats {
  const stats: SyncStats = { accounts: 0, inserted: 0, updated: 0, removed: 0, newLargeTxIds: [], newIncomeTxIds: [] };
  const insertedIds: string[] = [];
  const windowStartDate = localDate(windowStartUnix);
  const today = localDate(Math.floor(now / 1000));

  const cats = db.select().from(schema.categories).all();
  const categoryIdByName = new Map(cats.map((c) => [c.name, c.id]));
  const rules: RuleRow[] = db.select().from(schema.rules).all();
  const threshold = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get()?.largeTxThresholdCents ?? 20000;

  db.transaction((tx) => {
    for (const acct of result.accounts) {
      stats.accounts++;
      const accountRow = {
        connectionId,
        name: acct.name,
        type: guessAccountType(acct.name),
        lastFour: extractLastFour(acct.name),
        currency: acct.currency,
        balanceAvailableCents: acct.availableBalanceCents,
        balanceLedgerCents: acct.balanceCents,
        balanceUpdatedAt: acct.balanceDate !== null ? acct.balanceDate * 1000 : now,
      };
      tx.insert(schema.accounts)
        .values({ id: acct.id, ...accountRow })
        .onConflictDoUpdate({ target: schema.accounts.id, set: accountRow })
        .run();
      tx.insert(schema.balanceSnapshots)
        .values({
          accountId: acct.id,
          day: today,
          availableCents: acct.availableBalanceCents,
          ledgerCents: acct.balanceCents,
        })
        .onConflictDoUpdate({
          target: [schema.balanceSnapshots.accountId, schema.balanceSnapshots.day],
          set: { availableCents: acct.availableBalanceCents, ledgerCents: acct.balanceCents },
        })
        .run();

      const existing = new Map(
        tx
          .select()
          .from(schema.transactions)
          .where(eq(schema.transactions.accountId, acct.id))
          .all()
          .map((t) => [t.id, t]),
      );

      for (const t of acct.transactions) {
        const ts = t.transactedAt || t.posted || Math.floor(now / 1000);
        const values = {
          date: localDate(ts),
          amountCents: t.amountCents,
          description: t.description,
          counterparty: t.payee,
          merchantKey: merchantKey(t.payee, t.description),
          providerCategory: t.mcc,
          status: (t.pending ? "pending" : "posted") as "pending" | "posted",
        };
        const prev = existing.get(t.id);
        const cat = categorize(
          { description: t.description, counterparty: t.payee, amountCents: t.amountCents, mcc: t.mcc },
          rules,
          categoryIdByName,
        );

        if (!prev) {
          tx.insert(schema.transactions)
            .values({
              id: t.id,
              accountId: acct.id,
              ...values,
              categoryId: cat.categoryId,
              categorySource: cat.source,
              firstSeenAt: now,
              updatedAt: now,
            })
            .run();
          stats.inserted++;
          insertedIds.push(t.id);
          if (Math.abs(t.amountCents) >= threshold) stats.newLargeTxIds.push(t.id);
          continue;
        }

        const manual = prev.categorySource === "manual";
        const changed =
          prev.date !== values.date ||
          prev.amountCents !== values.amountCents ||
          prev.description !== values.description ||
          prev.counterparty !== values.counterparty ||
          prev.merchantKey !== values.merchantKey ||
          prev.providerCategory !== values.providerCategory ||
          prev.status !== values.status ||
          (!manual && (prev.categoryId !== cat.categoryId || prev.categorySource !== cat.source));
        if (!changed) continue;
        tx.update(schema.transactions)
          .set({
            ...values,
            ...(manual ? {} : { categoryId: cat.categoryId, categorySource: cat.source }),
            updatedAt: now,
          })
          .where(eq(schema.transactions.id, t.id))
          .run();
        stats.updated++;
      }

      // Reconcile: pending rows inside the pulled window that the bank no longer returns are gone
      // (they posted under a new id, or were dropped).
      const returned = acct.transactions.map((t) => t.id);
      const stale = tx
        .select({ id: schema.transactions.id })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.accountId, acct.id),
            eq(schema.transactions.status, "pending"),
            gte(schema.transactions.date, windowStartDate),
            returned.length ? notInArray(schema.transactions.id, returned) : undefined,
          ),
        )
        .all()
        .map((r) => r.id);
      for (let i = 0; i < stale.length; i += 500) {
        tx.delete(schema.transactions).where(inArray(schema.transactions.id, stale.slice(i, i + 500))).run();
      }
      stats.removed += stale.length;
    }
  });

  rebuildRecurring(db, today);
  // Save-plan bookkeeping must never fail a sync (the data above is already committed).
  try {
    stats.newIncomeTxIds = createSuggestionsForNew(db, insertedIds, now);
    updateFulfillment(db, now);
  } catch (e) {
    console.error("save plan update failed:", e instanceof Error ? e.message : "unknown error");
  }
  return stats;
}

// ---------- runSync ----------

export type SyncDeps = {
  db: DB;
  now: number;
  fetchAccounts: typeof realFetchAccounts;
  refreshWallets: ((db: DB) => Promise<void>) | null;
  backfill: boolean; // force a 90 day window (npm run backfill)
};

const g = globalThis as unknown as { __ownbankSyncRunning?: boolean };

export function isSyncRunning(): boolean {
  return g.__ownbankSyncRunning === true;
}

async function defaultRefreshWallets(db: DB): Promise<void> {
  const { refreshAllWallets } = await import("@/lib/solana/balances");
  await refreshAllWallets(db);
}

export async function runSync(trigger: SyncTrigger, deps: Partial<SyncDeps> = {}): Promise<SyncOutcome> {
  if (g.__ownbankSyncRunning) return { ok: false, skipped: "A sync is already running" };
  g.__ownbankSyncRunning = true;
  try {
    const db = deps.db ?? getDb();
    const now = deps.now ?? Date.now();
    const doFetch = deps.fetchAccounts ?? realFetchAccounts;
    const refreshWallets = deps.refreshWallets === undefined ? defaultRefreshWallets : deps.refreshWallets;

    const conn = db.select().from(schema.connections).orderBy(schema.connections.id).limit(1).get();
    if (!conn) return { ok: false, skipped: "No bank connection" };
    // Background triggers do not retry a broken connection (it needs a new token); manual does.
    if (conn.status === "broken" && trigger !== "manual") return { ok: false, skipped: "Connection is broken" };
    const windowDays = deps.backfill || backfillDue(db, now) ? BACKFILL_DAYS : WINDOW_DAYS;
    const endUnix = Math.floor(now / 1000);
    // 10 minute margin keeps a 90 day request inside the provider's 90 day limit.
    const startUnix = endUnix - windowDays * 86400 + (windowDays === BACKFILL_DAYS ? 600 : 0);
    const chunks = splitWindow(startUnix, endUnix);
    if (requestsInLast24h(db, now) + chunks.length > DAILY_REQUEST_BUDGET) {
      return { ok: false, skipped: "Daily SimpleFIN request budget reached" };
    }

    // Count the request before making it, so a crash mid-sync still counts.
    const run = db
      .insert(schema.syncRuns)
      .values({ trigger, startedAt: now, stats: JSON.stringify({ requests: chunks.length, window: windowDays }) })
      .returning({ id: schema.syncRuns.id })
      .get();

    let outcome: SyncOutcome;
    let flippedBroken = false;
    try {
      const accessUrl = decrypt(conn.accessTokenEnc);
      const parts: SfResult[] = [];
      for (const [lo, hi] of chunks) parts.push(await doFetch(accessUrl, { startDate: lo, endDate: hi, pending: true }));
      const result = mergeResults(parts);
      const stats = applySync(db, conn.id, result, now, startUnix);
      const institution = result.connectionNames[0] ?? result.accounts.find((a) => a.orgName)?.orgName ?? null;
      if (institution && conn.institutionName === "SimpleFIN") {
        db.update(schema.connections).set({ institutionName: institution.slice(0, 100) }).where(eq(schema.connections.id, conn.id)).run();
      }
      db.update(schema.connections)
        .set({ status: "active", lastSyncedAt: Date.now(), lastError: null })
        .where(eq(schema.connections.id, conn.id))
        .run();
      db.update(schema.syncRuns)
        .set({ finishedAt: Date.now(), ok: true, stats: JSON.stringify({ requests: chunks.length, window: windowDays, ...stats }) })
        .where(eq(schema.syncRuns.id, run.id))
        .run();
      outcome = { ok: true, stats };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed";
      // A network blip is not a broken connection; bad credentials or bad responses are.
      const transient = e instanceof SimpleFinError && (e.kind === "network" || e.kind === "request");
      flippedBroken = !transient && conn.status === "active";
      db.update(schema.connections)
        .set({ ...(transient ? {} : { status: "broken" as const }), lastError: message.slice(0, 500) })
        .where(eq(schema.connections.id, conn.id))
        .run();
      db.update(schema.syncRuns)
        .set({ finishedAt: Date.now(), ok: false, error: message.slice(0, 500) })
        .where(eq(schema.syncRuns.id, run.id))
        .run();
      outcome = { ok: false, error: message };
    }

    // Wallet balances are separate: a crypto failure never fails the bank sync.
    if (refreshWallets) {
      try {
        await refreshWallets(db);
      } catch (e) {
        console.error("wallet refresh failed:", e instanceof Error ? e.message : "unknown error");
      }
    }
    // Daily net worth snapshot (upserts today's row) after balances are fresh.
    try {
      writeSnapshot(db, now);
    } catch (e) {
      console.error("snapshot failed:", e instanceof Error ? e.message : "unknown error");
    }
    // Alerts last, after balances and snapshots are fresh. They never fail a sync.
    try {
      if (outcome.ok) await runSyncTriggers(db, outcome.stats, now);
      else if (flippedBroken) await disconnectTrigger(db, conn.id, now);
    } catch (e) {
      console.error("alerts failed:", e instanceof Error ? e.message : "unknown error");
    }
    return outcome;
  } finally {
    g.__ownbankSyncRunning = false;
  }
}
