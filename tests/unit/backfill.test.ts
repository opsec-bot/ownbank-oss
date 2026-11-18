import { beforeEach, describe, expect, it } from "vitest";
import fixture from "../fixtures/simplefin-accounts.json";
import { encrypt } from "@/lib/crypto";
import { openDb, schema, type DB } from "@/lib/db";
import { backfillDue, requestsInLast24h, runSync } from "@/lib/bank/sync";
import { SimpleFinError, mergeResults, parseAccountsResponse, splitWindow, type SfResult } from "@/lib/bank/simplefin";

const NOW = Date.UTC(2025, 10, 18, 18, 0, 0);
let db: DB;

function fresh(): SfResult {
  return parseAccountsResponse(JSON.parse(JSON.stringify(fixture)));
}

beforeEach(() => {
  db = openDb(":memory:");
  db.insert(schema.connections)
    .values({ providerConnectionId: "t", institutionName: "Fake", accessTokenEnc: encrypt("https://u:p@bridge.invalid/x"), createdAt: NOW })
    .run();
});

describe("90 day backfill", () => {
  it("uses a 90 day window once, then goes back to 30 days", async () => {
    const calls: { start: number; end: number }[] = [];
    const fetcher = async (_u: string, o: { startDate: number; endDate: number }) => {
      calls.push({ start: o.startDate, end: o.endDate });
      return fresh();
    };
    const deps = { db, fetchAccounts: fetcher as never, refreshWallets: null };
    expect(backfillDue(db, NOW)).toBe(true); // no accounts yet
    await runSync("manual", { ...deps, now: NOW });
    // 90 days is fetched as 45 day chunks (the bridge rejects longer ranges)
    expect(calls).toHaveLength(2);
    for (const c of calls) expect((c.end - c.start) / 86400).toBeLessThanOrEqual(45);
    const total = (Math.max(...calls.map((c) => c.end)) - Math.min(...calls.map((c) => c.start))) / 86400;
    expect(total).toBeGreaterThan(89.9);
    expect(total).toBeLessThanOrEqual(90);
    expect(backfillDue(db, NOW)).toBe(false);
    await runSync("manual", { ...deps, now: NOW + 3600_000 });
    expect(calls).toHaveLength(3);
    expect((calls[2].end - calls[2].start) / 86400).toBe(30);
  });

  it("counts against the request budget and records the window", async () => {
    await runSync("manual", { db, now: NOW, fetchAccounts: (async () => fresh()) as never, refreshWallets: null });
    const run = db.select().from(schema.syncRuns).get()!;
    expect(JSON.parse(run.stats!)).toMatchObject({ requests: 2, window: 90 });
    expect(requestsInLast24h(db, NOW + 1000)).toBe(2);
  });

  it("an explicit backfill forces 90 days even when history looks long enough", async () => {
    const calls: number[] = [];
    const fetcher = async (_u: string, o: { startDate: number; endDate: number }) => {
      calls.push((o.endDate - o.startDate) / 86400);
      return fresh();
    };
    const deps = { db, fetchAccounts: fetcher as never, refreshWallets: null };
    await runSync("manual", { ...deps, now: NOW });
    await runSync("manual", { ...deps, now: NOW + 3600_000, backfill: true });
    expect(calls).toHaveLength(4); // the first sync is already a 90 day one (2 chunks), the forced one adds 2 more
  });

  it("splits long windows into chunks and merges results without duplicates", () => {
    const chunks = splitWindow(1000, 1000 + 100 * 86400);
    expect(chunks.length).toBe(3);
    expect(chunks[0][1]).toBe(1000 + 100 * 86400); // newest first
    expect(chunks[chunks.length - 1][0]).toBe(1000);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i][1]).toBe(chunks[i - 1][0]);
    expect(splitWindow(0, 10)).toEqual([[0, 10]]);
    const a = fresh();
    const b = fresh();
    const merged = mergeResults([a, b]);
    expect(merged.accounts.map((x) => x.transactions.length)).toEqual(a.accounts.map((x) => x.transactions.length));
  });

  it("a request-level bridge error does not mark the connection broken", async () => {
    const bad = async (): Promise<SfResult> => {
      throw new SimpleFinError("gen.api: Requested date range exceeds recommended range of 45 days.", "request");
    };
    const out = await runSync("manual", { db, now: NOW, fetchAccounts: bad, refreshWallets: null });
    expect(out.ok).toBe(false);
    expect(db.select().from(schema.connections).get()!.status).toBe("active");
    expect(() => parseAccountsResponse({ errlist: [{ code: "gen.api", msg: "Requested date range exceeds" }], accounts: [] })).toThrow(
      expect.objectContaining({ kind: "request" }),
    );
    expect(() => parseAccountsResponse({ errlist: [{ code: "con.auth", msg: "Authentication needed" }], accounts: [] })).toThrow(
      expect.objectContaining({ kind: "auth" }),
    );
  });

  it("writes today's net worth snapshot after a sync", async () => {
    await runSync("manual", { db, now: NOW, fetchAccounts: (async () => fresh()) as never, refreshWallets: null });
    const rows = db.select().from(schema.netWorthSnapshots).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].day).toBe("2025-11-18");
    await runSync("manual", { db, now: NOW + 60_000, fetchAccounts: (async () => fresh()) as never, refreshWallets: null });
    expect(db.select().from(schema.netWorthSnapshots).all()).toHaveLength(1); // upsert, one row per day
  });
});
