import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { runSync } from "@/lib/bank/sync";
import { SimpleFinError, type SfResult } from "@/lib/bank/simplefin";
import { schema, type DB } from "@/lib/db";
import { setBudget } from "@/lib/finance/budgets";
import { digestPushBody, publishDigest } from "@/lib/finance/digest";
import { rebuildRecurring } from "@/lib/finance/recurring";
import { decideActions } from "@/lib/push/schedule";
import { schedulerTick } from "@/lib/push/scheduler";
import type { Sender, VapidDetails } from "@/lib/push/send";
import {
  baselineGoalMilestones,
  budgetTrigger,
  disconnectTrigger,
  goalTrigger,
  incomeSaveTrigger,
  largeTxTrigger,
  lowBalanceTrigger,
} from "@/lib/push/triggers";
import { addAccount, addTx, catId, freshDb } from "../helpers/seed";

const VAPID: VapidDetails = { subject: "mailto:test@example.invalid", publicKey: "pub", privateKey: "priv" };
const NOON = Date.UTC(2025, 10, 18, 18, 0, 0); // 2025-11-18 12:00 Chicago
const at = (h: number, m: number, day = 19) => Date.UTC(2025, 10, day, h + 6, m); // Chicago wall time, CST

let db: DB;
let sent: { title: string; body: string; url: string }[];
const sender: Sender = async (_sub, payload) => {
  sent.push(JSON.parse(payload));
};
const opts = (now = NOON) => ({ now, sender, vapid: VAPID });

function addSub() {
  db.insert(schema.pushSubscriptions).values({ endpoint: "https://push.example.invalid/a", p256dh: "p".repeat(20), auth: "a".repeat(20), createdAt: NOON }).run();
}

beforeEach(() => {
  db = freshDb();
  addAccount(db, "A1", { available: 120000 });
  addSub();
  sent = [];
});

describe("decideActions (digest scheduling)", () => {
  const none = { hasDigestToday: false, queuedCount: 0 };
  it("does nothing before 8:15 and sends no digest at 8:00", () => {
    expect(decideActions(at(8, 0), none)).toEqual([]);
    expect(decideActions(at(8, 14), none)).toEqual([]);
  });
  it("generates the auto digest at 8:15 when nothing was posted", () => {
    expect(decideActions(at(8, 15), none)).toEqual(["auto_digest"]);
  });
  it("skips it when a digest (Claude's) already exists for today", () => {
    expect(decideActions(at(8, 15), { ...none, hasDigestToday: true })).toEqual([]);
  });
  it("catches up after a restart until noon, then stops", () => {
    expect(decideActions(at(10, 30), none)).toEqual(["auto_digest"]);
    expect(decideActions(at(12, 0), none)).toEqual([]);
  });
  it("flushes the quiet-hours queue from 7:00, not before", () => {
    expect(decideActions(at(6, 59), { ...none, queuedCount: 2 })).toEqual([]);
    expect(decideActions(at(7, 0), { ...none, queuedCount: 2 })).toEqual(["flush_queue"]);
    expect(decideActions(at(8, 15), { hasDigestToday: false, queuedCount: 1 })).toEqual(["flush_queue", "auto_digest"]);
  });
  it("does not flush when nothing is queued, and never at night", () => {
    expect(decideActions(at(9, 0), none)).toEqual(["auto_digest"]);
    expect(decideActions(at(23, 0), { ...none, queuedCount: 3 })).toEqual([]);
  });
});

describe("schedulerTick", () => {
  it("stores and pushes the auto digest once at 8:15", async () => {
    expect(await schedulerTick(db, at(8, 15), opts())).toEqual(["auto_digest"]);
    const row = db.select().from(schema.digests).get()!;
    expect(row).toMatchObject({ day: "2025-11-19", source: "auto" });
    expect(await schedulerTick(db, at(8, 16), opts())).toEqual([]);
    expect(db.select().from(schema.notifications).all().filter((n) => n.kind === "digest")).toHaveLength(1);
  });

  it("does not generate an auto digest when Claude already posted", async () => {
    db.insert(schema.digests).values({ day: "2025-11-19", source: "claude", bodyMd: "hi", createdAt: 1 }).run();
    expect(await schedulerTick(db, at(8, 15), opts())).toEqual([]);
    expect(db.select().from(schema.digests).get()!.source).toBe("claude");
  });

  it("flushes pushes queued overnight at 7 AM", async () => {
    await import("@/lib/push/send").then((m) =>
      m.notify(db, { kind: "low_balance", title: "L", body: "b", key: "low_balance:2025-11-18" }, { now: at(23, 0, 18), sender, vapid: VAPID }),
    );
    expect(sent).toHaveLength(0);
    expect(await schedulerTick(db, at(7, 0), opts())).toEqual(["flush_queue"]);
    expect(sent.map((s) => s.title)).toEqual(["L"]);
  });
});

describe("publishDigest", () => {
  const day = "2025-11-19";
  it("pushes a Claude digest that arrives first as the day's digest", async () => {
    // publishDigest uses the real sender only when VAPID is set; none is set in tests, so check the log row.
    const r = await publishDigest(day, "Hello **there**\n- detail", "claude", { db, now: at(8, 0) });
    expect(r.stored).toBe(true);
    const n = db.select().from(schema.notifications).get()!;
    expect(n).toMatchObject({ title: "Today", url: "/digest", dedupeKey: `digest:claude:${day}` });
  });
  it("says Claude's digest is ready when it lands after the auto one", async () => {
    await publishDigest(day, "numbers", "auto", { db, now: at(8, 15) });
    await publishDigest(day, "Claude wrote this", "claude", { db, now: at(8, 40) });
    expect(db.select().from(schema.digests).get()).toMatchObject({ source: "claude", bodyMd: "Claude wrote this" });
    const titles = db.select().from(schema.notifications).all().map((n) => n.title);
    expect(titles).toEqual(["Today", "Claude's digest is ready"]);
  });
  it("never replaces a Claude digest with an auto one, and repeat posts do not repush", async () => {
    await publishDigest(day, "from claude", "claude", { db, now: at(8, 0) });
    const r = await publishDigest(day, "auto numbers", "auto", { db, now: at(8, 15) });
    expect(r.push).toBe("duplicate");
    expect(db.select().from(schema.digests).get()!.bodyMd).toBe("from claude");
    await publishDigest(day, "from claude v2", "claude", { db, now: at(9, 0) });
    expect(db.select().from(schema.notifications).all()).toHaveLength(1);
  });
  it("body is the first lines without markdown marks or the heading", () => {
    const md = "Digest for 2025-11-19\n\n- Yesterday: $12.00 out\n  - nested: skip\n- **Bold** `code` line\n- Third\n- Fourth";
    expect(digestPushBody(md)).toBe("Yesterday: $12.00 out\nBold code line\nThird");
  });
});

function seedPlan() {
  for (const d of ["2025-09-05", "2025-10-03", "2025-11-03"]) addTx(db, { date: d, amount: 100000, description: "ACME PAYROLL", payee: "Acme", category: "Income" });
  for (const d of ["2025-09-01", "2025-10-01", "2025-11-01"]) addTx(db, { date: d, amount: -50000, description: "FAKE LANDLORD", payee: "Fake Landlord", category: "Other" });
  addTx(db, { date: "2025-11-10", amount: -9000, description: "FAKE DINER", category: "Dining" });
  rebuildRecurring(db, "2025-11-18");
}

describe("income trigger", () => {
  function deposit(id: string, cents: number, suggested: number, reason = "20% of the deposit") {
    db.insert(schema.saveSuggestions).values({ incomeTxId: id, suggestedCents: suggested, reason, createdAt: NOON }).run();
    return { id, cents };
  }
  it("one deposit: Got $X, move $Y to savings", async () => {
    const id = addTx(db, { date: "2025-11-18", amount: 100000, description: "ACME PAYROLL", category: "Income" });
    deposit(id, 100000, 20000);
    await incomeSaveTrigger(db, [id], opts());
    expect(sent[0].body).toBe("Got $1,000.00 → move $200.00 to savings");
  });
  it("several deposits in one sync make one combined push", async () => {
    const ids = [60000, 40000, 25000].map((c) => addTx(db, { date: "2025-11-18", amount: c, description: "WAGE PAYOUT", category: "Income" }));
    ids.forEach((id, i) => deposit(id, 0, [12000, 8000, 5000][i]));
    await incomeSaveTrigger(db, ids, opts());
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toBe("Got $1,250.00 from 3 deposits → move $250.00 to savings");
  });
  it("explains briefly when the suggestion is 0", async () => {
    const id = addTx(db, { date: "2025-11-18", amount: 50000, description: "ACME PAYROLL", category: "Income" });
    deposit(id, 0, 0, "Bills before the next income leave no room above the $50.00 buffer");
    await incomeSaveTrigger(db, [id], opts());
    expect(sent[0].body).toBe("Got $500.00. Nothing to move right now: bills before the next income leave no room above the $50.00 buffer");
  });
  it("does not repeat for the same deposits", async () => {
    const id = addTx(db, { date: "2025-11-18", amount: 50000, description: "ACME PAYROLL", category: "Income" });
    deposit(id, 0, 10000);
    await incomeSaveTrigger(db, [id], opts());
    await incomeSaveTrigger(db, [id], opts());
    expect(sent).toHaveLength(1);
  });
});

describe("large transaction trigger", () => {
  it("alerts on recent outflows only; skips inflows, old rows and savings transfers", async () => {
    const out = addTx(db, { date: "2025-11-17", amount: -25000, description: "BIG BUY", category: "Shopping" });
    const inflow = addTx(db, { date: "2025-11-17", amount: 90000, description: "PAYROLL", category: "Income" });
    const old = addTx(db, { date: "2025-10-01", amount: -30000, description: "OLD BUY", category: "Shopping" });
    const save = addTx(db, { date: "2025-11-17", amount: -30000, description: "TO SAVINGS", category: "Savings transfer" });
    await largeTxTrigger(db, [out, inflow, old, save], NOON, opts());
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("Large transaction");
    expect(sent[0].body).toMatch(/^\$250\.00 at /);
    await largeTxTrigger(db, [out], NOON, opts());
    expect(sent).toHaveLength(1);
  });
  it("skips every transfer-kind category and names the merchant plainly", async () => {
    const zelle = addTx(db, { date: "2025-11-17", amount: -50000, description: "ZELLE TO FRIEND", category: "Personal transfer" });
    const sav = addTx(db, { date: "2025-11-17", amount: -50000, description: "ONLINE BANKING TRANSFER TO SAV 4471", category: "Savings transfer" });
    await largeTxTrigger(db, [zelle, sav], NOON, opts());
    expect(sent).toHaveLength(0);
    const shop = addTx(db, { date: "2025-11-17", amount: -25000, description: "BEST BUY 123", category: "Shopping" });
    await largeTxTrigger(db, [shop], NOON, opts());
    expect(sent[0].body).toMatch(/^\$250\.00 at [A-Z]/);
  });
  it("combines more than three into one push", async () => {
    const ids = [1, 2, 3, 4].map((i) => addTx(db, { date: "2025-11-17", amount: -20000 * i, description: `BIG BUY ${i}`, category: "Shopping" }));
    await largeTxTrigger(db, ids, NOON, opts());
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toBe("4 large charges, $2,000.00 total");
  });
});

describe("low balance trigger", () => {
  it("fires when checking dips under the buffer before income, once per day", async () => {
    seedPlan();
    db.update(schema.accounts).set({ balanceAvailableCents: 5500, balanceLedgerCents: 5500 }).run();
    await lowBalanceTrigger(db, NOON, opts());
    await lowBalanceTrigger(db, NOON + 3_600_000, opts());
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("Low balance ahead");
    expect(sent[0].body).toMatch(/projected under \$50\.00 on \d\d\/\d\d/);
    // next day is a new key
    await lowBalanceTrigger(db, NOON + 24 * 3_600_000, opts());
    expect(sent).toHaveLength(2);
  });
  it("stays quiet when there is plenty of cash", async () => {
    seedPlan();
    await lowBalanceTrigger(db, NOON, opts());
    expect(sent).toHaveLength(0);
  });
});

describe("disconnect", () => {
  it("pushes immediately, even at night", async () => {
    await disconnectTrigger(db, 1, at(2, 0), opts(at(2, 0)));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ body: "Bank connection broken — tap to re-link", url: "/settings/bank#replace" });
  });
  it("runSync fires it when the connection flips to broken, once", async () => {
    const conn = db.select().from(schema.connections).get()!;
    db.update(schema.connections).set({ accessTokenEnc: encrypt("https://u:p@bridge.invalid/x") }).where(eq(schema.connections.id, conn.id)).run();
    const bad = async (): Promise<SfResult> => {
      throw new SimpleFinError("Authentication needed", "auth");
    };
    await runSync("cron", { db, now: NOON, fetchAccounts: bad, refreshWallets: null });
    await runSync("cron", { db, now: NOON + 1000, fetchAccounts: bad, refreshWallets: null }); // skipped: already broken
    const rows = db.select().from(schema.notifications).all().filter((n) => n.kind === "disconnect");
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("/settings/bank#replace");
  });
  it("a network blip does not push", async () => {
    const net = async (): Promise<SfResult> => {
      throw new SimpleFinError("Could not reach SimpleFIN", "network");
    };
    await runSync("cron", { db, now: NOON, fetchAccounts: net, refreshWallets: null });
    expect(db.select().from(schema.notifications).all().filter((n) => n.kind === "disconnect")).toHaveLength(0);
  });
});

describe("budget trigger", () => {
  it("sends each threshold once per month", async () => {
    addTx(db, { date: "2025-11-10", amount: -25000, description: "FAKE DINER", category: "Dining" });
    setBudget(db, catId(db, "Dining"), 30000);
    await budgetTrigger(db, NOON, opts());
    await budgetTrigger(db, NOON, opts());
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatch(/^Dining: \$250 of \$300 \(83%\) with 60% of the month gone$/);
    addTx(db, { date: "2025-11-17", amount: -6000, description: "FAKE DINER 2", category: "Dining" });
    await budgetTrigger(db, NOON, opts());
    expect(sent).toHaveLength(2);
    expect(sent[1].title).toBe("Dining over budget");
    await budgetTrigger(db, NOON, opts());
    expect(sent).toHaveLength(2);
  });
});

describe("goal trigger", () => {
  function setup(stable: number) {
    db.insert(schema.cryptoWallets).values({ address: "SAVINGS1111111111111111111111111111111111111", role: "savings", stableUsdCents: stable, totalUsdCents: stable }).run();
    db.insert(schema.savingsGoal).values({ id: 1, name: "Car", targetCents: 100000, createdAt: 42 }).run();
  }
  const setStable = (c: number) => db.update(schema.cryptoWallets).set({ stableUsdCents: c, totalUsdCents: c }).run();

  it("pushes 25/50/75/100 as each is crossed, once", async () => {
    setup(0);
    baselineGoalMilestones(db, NOON);
    await goalTrigger(db, NOON, opts());
    expect(sent).toHaveLength(0);
    setStable(26000);
    await goalTrigger(db, NOON, opts());
    await goalTrigger(db, NOON, opts());
    expect(sent.map((s) => s.title)).toEqual(["Goal 25%"]);
    setStable(80000);
    await goalTrigger(db, NOON, opts());
    expect(sent.map((s) => s.title)).toEqual(["Goal 25%", "Goal 75%"]); // jumped past 50: one push for the highest
    setStable(100000);
    await goalTrigger(db, NOON, opts());
    expect(sent[2].title).toBe("Goal reached");
    expect(sent).toHaveLength(3);
  });

  it("milestones already passed when the goal was set do not push", async () => {
    setup(60000);
    baselineGoalMilestones(db, NOON);
    await goalTrigger(db, NOON, opts());
    expect(sent).toHaveLength(0);
    setStable(76000);
    await goalTrigger(db, NOON, opts());
    expect(sent.map((s) => s.title)).toEqual(["Goal 75%"]);
  });

  it("trading wallets never move the goal", async () => {
    setup(0);
    baselineGoalMilestones(db, NOON);
    db.insert(schema.cryptoWallets).values({ address: "TRADING1111111111111111111111111111111111111", role: "trading", stableUsdCents: 900000, totalUsdCents: 900000 }).run();
    await goalTrigger(db, NOON, opts());
    expect(sent).toHaveLength(0);
  });
});

vi.spyOn(console, "error").mockImplementation(() => {});
