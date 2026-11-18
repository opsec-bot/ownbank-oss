import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fixture from "../fixtures/simplefin-accounts.json";
import { encrypt } from "@/lib/crypto";
import { openDb, schema, type DB } from "@/lib/db";
import { applySync, budgetAllows, requestsInLast24h, runSync, shouldOpenSync } from "@/lib/bank/sync";
import { SimpleFinError, parseAccountsResponse, type SfResult } from "@/lib/bank/simplefin";
import { allowHit } from "@/lib/rate-limit";

const NOW = Date.UTC(2025, 10, 18, 18, 0, 0); // fixture timestamps are ~Nov 17-18 2025
const WINDOW_START = Math.floor(NOW / 1000) - 30 * 86400;

let db: DB;
let connId: number;

function fresh(): SfResult {
  return parseAccountsResponse(JSON.parse(JSON.stringify(fixture)));
}

function cat(name: string): number {
  return db.select().from(schema.categories).where(eq(schema.categories.name, name)).get()!.id;
}

function addRuns(n: number, startedAt: number) {
  for (let i = 0; i < n; i++) {
    db.insert(schema.syncRuns).values({ trigger: "cron", startedAt, stats: JSON.stringify({ requests: 1 }) }).run();
  }
}

beforeEach(() => {
  db = openDb(":memory:");
  connId = db
    .insert(schema.connections)
    .values({
      providerConnectionId: "test",
      institutionName: "Fake Test Bank",
      accessTokenEnc: encrypt("https://u:p@bridge.invalid/simplefin"),
      createdAt: NOW,
    })
    .returning({ id: schema.connections.id })
    .get().id;
});

describe("applySync", () => {
  it("inserts accounts and transactions with categories", () => {
    const stats = applySync(db, connId, fresh(), NOW, WINDOW_START);
    expect(stats).toMatchObject({ accounts: 2, inserted: 3, updated: 0, removed: 0 });
    const accts = db.select().from(schema.accounts).all();
    expect(accts.find((a) => a.id === "ACT-FAKE-1")).toMatchObject({
      type: "depository",
      lastFour: "1234",
      balanceLedgerCents: 10050,
      balanceAvailableCents: 9025,
    });
    expect(accts.find((a) => a.id === "ACT-FAKE-2")).toMatchObject({ type: "credit", lastFour: "9876", balanceLedgerCents: -25000 });
    const byId = Object.fromEntries(db.select().from(schema.transactions).all().map((t) => [t.id, t]));
    expect(byId["TX-1"]).toMatchObject({
      categoryId: cat("Groceries"),
      categorySource: "provider",
      status: "posted",
      merchantKey: "fake grocery",
    });
    expect(byId["TX-2"]).toMatchObject({ status: "pending", categoryId: cat("Other") });
    expect(byId["TX-3"]).toMatchObject({ categoryId: cat("Income"), amountCents: 250000 });
    expect(stats.newLargeTxIds).toEqual(["TX-3"]);
    expect(db.select().from(schema.balanceSnapshots).all()).toHaveLength(2);
  });

  it("is idempotent and keeps one snapshot per day", () => {
    applySync(db, connId, fresh(), NOW, WINDOW_START);
    const again = applySync(db, connId, fresh(), NOW + 1000, WINDOW_START);
    expect(again).toMatchObject({ inserted: 0, updated: 0, removed: 0 });
    expect(db.select().from(schema.transactions).all()).toHaveLength(3);
    expect(db.select().from(schema.balanceSnapshots).all()).toHaveLength(2);
  });

  it("keeps manual categories on update", () => {
    applySync(db, connId, fresh(), NOW, WINDOW_START);
    db.update(schema.transactions)
      .set({ categoryId: cat("Travel"), categorySource: "manual" })
      .where(eq(schema.transactions.id, "TX-1"))
      .run();
    const changed = fresh();
    changed.accounts[0].transactions[0].amountCents = -2000;
    const stats = applySync(db, connId, changed, NOW, WINDOW_START);
    expect(stats.updated).toBe(1);
    const row = db.select().from(schema.transactions).where(eq(schema.transactions.id, "TX-1")).get()!;
    expect(row).toMatchObject({ amountCents: -2000, categoryId: cat("Travel"), categorySource: "manual" });
  });

  it("applies rules over MCC and re-categorizes non-manual rows", () => {
    applySync(db, connId, fresh(), NOW, WINDOW_START);
    db.insert(schema.rules)
      .values({ field: "description", matchType: "contains", pattern: "fake grocery", categoryId: cat("Shopping"), createdAt: NOW })
      .run();
    applySync(db, connId, fresh(), NOW, WINDOW_START);
    const row = db.select().from(schema.transactions).where(eq(schema.transactions.id, "TX-1")).get()!;
    expect(row).toMatchObject({ categoryId: cat("Shopping"), categorySource: "rule" });
  });

  it("pending to posted under a new id removes the stale pending row", () => {
    applySync(db, connId, fresh(), NOW, WINDOW_START);
    const next = fresh();
    const pending = next.accounts[0].transactions.find((t) => t.id === "TX-2")!;
    pending.id = "TX-2-POSTED";
    pending.pending = false;
    pending.posted = 1763360000;
    const stats = applySync(db, connId, next, NOW, WINDOW_START);
    expect(stats).toMatchObject({ inserted: 1, removed: 1 });
    const ids = db.select().from(schema.transactions).all().map((t) => t.id).sort();
    expect(ids).toEqual(["TX-1", "TX-2-POSTED", "TX-3"]);
  });

  it("never reconciles posted rows or rows outside the window", () => {
    applySync(db, connId, fresh(), NOW, WINDOW_START);
    db.insert(schema.transactions)
      .values({
        id: "OLD-PENDING",
        accountId: "ACT-FAKE-1",
        date: "2025-01-01",
        amountCents: -100,
        description: "old",
        status: "pending",
        firstSeenAt: NOW,
        updatedAt: NOW,
      })
      .run();
    const next = fresh();
    next.accounts[0].transactions = [];
    const stats = applySync(db, connId, next, NOW, WINDOW_START);
    // TX-2 (pending, in window) goes; posted TX-1/TX-3 and the old pending row stay.
    expect(stats.removed).toBe(1);
    const ids = db.select().from(schema.transactions).all().map((t) => t.id).sort();
    expect(ids).toEqual(["OLD-PENDING", "TX-1", "TX-3"]);
  });
});

describe("request budget", () => {
  it("counts requests in the last 24h and refuses past the limit", () => {
    addRuns(20, NOW - 3600_000);
    db.insert(schema.syncRuns)
      .values({ trigger: "cron", startedAt: NOW - 25 * 3600_000, stats: JSON.stringify({ requests: 5 }) })
      .run();
    expect(requestsInLast24h(db, NOW)).toBe(20);
    expect(budgetAllows(db, NOW)).toBe(false);
    expect(budgetAllows(db, NOW + 24 * 3600_000)).toBe(true);
  });
});

describe("runSync", () => {
  const ok = async () => fresh();
  const base = { refreshWallets: null };

  it("syncs, marks the connection active and records a run", async () => {
    const out = await runSync("manual", { db, now: NOW, fetchAccounts: ok, ...base });
    expect(out).toMatchObject({ ok: true, stats: { accounts: 2, inserted: 3 } });
    const conn = db.select().from(schema.connections).get()!;
    expect(conn.status).toBe("active");
    expect(conn.lastSyncedAt).not.toBeNull();
    expect(db.select().from(schema.syncRuns).get()).toMatchObject({ ok: true, trigger: "manual" });
  });

  it("marks the connection broken on provider errors and skips background retries", async () => {
    const bad = async (): Promise<SfResult> => {
      throw new SimpleFinError("Authentication needed", "auth");
    };
    const out = await runSync("cron", { db, now: NOW, fetchAccounts: bad, ...base });
    expect(out).toEqual({ ok: false, error: "Authentication needed" });
    expect(db.select().from(schema.connections).get()).toMatchObject({ status: "broken", lastError: "Authentication needed" });
    const skipped = await runSync("open", { db, now: NOW, fetchAccounts: ok, ...base });
    expect(skipped).toEqual({ ok: false, skipped: "Connection is broken" });
    const manual = await runSync("manual", { db, now: NOW, fetchAccounts: ok, ...base });
    expect(manual.ok).toBe(true);
    expect(db.select().from(schema.connections).get()!.status).toBe("active");
  });

  it("keeps status on network blips", async () => {
    const net = async (): Promise<SfResult> => {
      throw new SimpleFinError("Could not reach SimpleFIN", "network");
    };
    await runSync("cron", { db, now: NOW, fetchAccounts: net, ...base });
    expect(db.select().from(schema.connections).get()).toMatchObject({
      status: "active",
      lastError: "Could not reach SimpleFIN",
    });
  });

  it("skips when the daily budget is used", async () => {
    addRuns(20, NOW - 1000);
    const out = await runSync("manual", { db, now: NOW, fetchAccounts: ok, ...base });
    expect(out).toMatchObject({ ok: false, skipped: expect.stringContaining("budget") });
  });

  it("does not run twice at once and survives wallet failures", async () => {
    // The first sync is a 90 day backfill (two chunked requests), so every call waits on the same gate.
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const slow = async () => {
      await gate;
      return fresh();
    };
    const first = runSync("manual", {
      db,
      now: NOW,
      fetchAccounts: slow,
      refreshWallets: async () => {
        throw new Error("helius down");
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    const second = await runSync("manual", { db, now: NOW, fetchAccounts: ok, ...base });
    expect(second).toEqual({ ok: false, skipped: "A sync is already running" });
    release();
    expect((await first).ok).toBe(true);
  });
});

describe("allowHit", () => {
  it("limits per window", () => {
    for (let i = 0; i < 6; i++) expect(allowHit("sync", 3600_000, 6, db, NOW)).toBe(true);
    expect(allowHit("sync", 3600_000, 6, db, NOW)).toBe(false);
    expect(allowHit("sync", 3600_000, 6, db, NOW + 3600_000)).toBe(true);
  });
});

describe("shouldOpenSync", () => {
  const setConn = (patch: Partial<typeof schema.connections.$inferInsert>) =>
    db.update(schema.connections).set(patch).where(eq(schema.connections.id, connId)).run();

  it("fires when never synced or older than 60 minutes", () => {
    expect(shouldOpenSync(db, NOW)).toBe(true);
    setConn({ lastSyncedAt: NOW - 61 * 60_000 });
    expect(shouldOpenSync(db, NOW)).toBe(true);
  });
  it("does not fire when fresh, broken, or just attempted", () => {
    setConn({ lastSyncedAt: NOW - 30 * 60_000 });
    expect(shouldOpenSync(db, NOW)).toBe(false);
    setConn({ lastSyncedAt: NOW - 120 * 60_000, status: "broken" });
    expect(shouldOpenSync(db, NOW)).toBe(false);
    setConn({ status: "active" });
    addRuns(1, NOW - 2 * 60_000);
    expect(shouldOpenSync(db, NOW)).toBe(false);
  });
});
