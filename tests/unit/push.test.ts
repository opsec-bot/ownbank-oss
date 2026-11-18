import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sendNotification } from "web-push";
import { schema, type DB } from "@/lib/db";
import { flushQueued, notify, queuedCount, sendPush, type Sender, type VapidDetails } from "@/lib/push/send";
import { chicagoParts, isQuietHours } from "@/lib/push/time";
import { deviceLabel } from "@/lib/push/device";
import { freshDb } from "../helpers/seed";

vi.mock("web-push", () => ({ sendNotification: vi.fn() }));

const VAPID: VapidDetails = { subject: "mailto:test@example.invalid", publicKey: "pub", privateKey: "priv" };
const NOON = Date.UTC(2025, 10, 18, 18, 0, 0); // 2025-11-18 12:00 Chicago (CST, UTC-6)
const NIGHT = Date.UTC(2025, 10, 19, 5, 0, 0); // 2025-11-18 23:00 Chicago
const MORNING = Date.UTC(2025, 10, 19, 13, 30, 0); // 2025-11-19 07:30 Chicago

let db: DB;
let sent: { endpoint: string; body: { title: string; body: string; url: string; tag?: string } }[];
const sender: Sender = async (sub, payload) => {
  sent.push({ endpoint: sub.endpoint, body: JSON.parse(payload) });
};

function addSub(endpoint = "https://push.example.invalid/a") {
  db.insert(schema.pushSubscriptions).values({ endpoint, p256dh: "p".repeat(20), auth: "a".repeat(20), createdAt: NOON }).run();
}

beforeEach(() => {
  db = freshDb();
  sent = [];
  vi.mocked(sendNotification).mockReset();
});

describe("quiet hours", () => {
  it("is quiet from 10 PM to 7 AM Chicago", () => {
    expect(isQuietHours(Date.UTC(2025, 10, 19, 3, 59))).toBe(false); // 21:59
    expect(isQuietHours(Date.UTC(2025, 10, 19, 4, 0))).toBe(true); // 22:00
    expect(isQuietHours(Date.UTC(2025, 10, 19, 12, 59))).toBe(true); // 06:59
    expect(isQuietHours(Date.UTC(2025, 10, 19, 13, 0))).toBe(false); // 07:00
  });
  it("follows daylight saving time", () => {
    expect(chicagoParts(Date.UTC(2025, 6, 1, 12, 0))).toEqual({ day: "2025-07-01", hour: 7, minute: 0 }); // CDT
    expect(isQuietHours(Date.UTC(2025, 6, 1, 11, 59))).toBe(true);
    expect(isQuietHours(Date.UTC(2025, 6, 1, 12, 0))).toBe(false);
  });
  it("reports midnight as hour 0", () => {
    expect(chicagoParts(Date.UTC(2025, 10, 19, 6, 5))).toEqual({ day: "2025-11-19", hour: 0, minute: 5 });
  });
});

describe("notify", () => {
  it("sends once and logs it; the same key never sends twice", async () => {
    addSub();
    const n = { kind: "large_tx" as const, title: "T", body: "B", key: "large_tx:1" };
    expect(await notify(db, n, { now: NOON, sender, vapid: VAPID })).toBe("sent");
    expect(await notify(db, n, { now: NOON + 1000, sender, vapid: VAPID })).toBe("duplicate");
    expect(sent).toHaveLength(1);
    const rows = db.select().from(schema.notifications).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "large_tx", dedupeKey: "large_tx:1", delivered: 1 });
  });

  it("different keys both send, and keyless pushes always send", async () => {
    addSub();
    await notify(db, { kind: "goal", title: "a", body: "b", key: "goal:1:25" }, { now: NOON, sender, vapid: VAPID });
    await notify(db, { kind: "goal", title: "a", body: "b", key: "goal:1:50" }, { now: NOON, sender, vapid: VAPID });
    await notify(db, { kind: "test", title: "a", body: "b" }, { now: NOON, sender, vapid: VAPID });
    await notify(db, { kind: "test", title: "a", body: "b" }, { now: NOON, sender, vapid: VAPID });
    expect(sent).toHaveLength(4);
  });

  it("skips a kind whose toggle is off and records nothing", async () => {
    addSub();
    db.update(schema.settings).set({ pushBudgetPace: false }).where(eq(schema.settings.id, 1)).run();
    expect(await notify(db, { kind: "budget_pace", title: "a", body: "b", key: "k" }, { now: NOON, sender, vapid: VAPID })).toBe("disabled");
    expect(sent).toHaveLength(0);
    expect(db.select().from(schema.notifications).all()).toHaveLength(0);
  });

  it("queues during quiet hours (delivered 0) and flushes after 7 AM", async () => {
    addSub();
    expect(await notify(db, { kind: "low_balance", title: "L", body: "b", key: "low_balance:d" }, { now: NIGHT, sender, vapid: VAPID })).toBe("queued");
    expect(sent).toHaveLength(0);
    expect(queuedCount(db)).toBe(1);
    // still quiet: nothing goes out
    expect(await flushQueued(db, NIGHT + 60_000, { sender, vapid: VAPID })).toBe(0);
    expect(await flushQueued(db, MORNING, { sender, vapid: VAPID })).toBe(1);
    expect(sent.map((s) => s.body.title)).toEqual(["L"]);
    expect(queuedCount(db)).toBe(0);
    expect(db.select().from(schema.notifications).get()!.delivered).toBe(1);
    // a second flush does not resend
    expect(await flushQueued(db, MORNING + 60_000, { sender, vapid: VAPID })).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("a queued key still dedupes", async () => {
    addSub();
    const n = { kind: "digest" as const, title: "T", body: "b", key: "digest:auto:d" };
    await notify(db, n, { now: NIGHT, sender, vapid: VAPID });
    expect(await notify(db, n, { now: MORNING, sender, vapid: VAPID })).toBe("duplicate");
  });

  it("disconnect and test ignore quiet hours", async () => {
    addSub();
    expect(await notify(db, { kind: "disconnect", title: "D", body: "b", key: "disconnect:1:1" }, { now: NIGHT, sender, vapid: VAPID })).toBe("sent");
    expect(await notify(db, { kind: "test", title: "t", body: "b" }, { now: NIGHT, sender, vapid: VAPID })).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("marks undeliverable (2) when there are no devices or no VAPID keys", async () => {
    expect(await notify(db, { kind: "goal", title: "a", body: "b", key: "x" }, { now: NOON, sender, vapid: VAPID })).toBe("undelivered");
    addSub();
    expect(await notify(db, { kind: "goal", title: "a", body: "b", key: "y" }, { now: NOON, sender, vapid: null })).toBe("undelivered");
    expect(db.select().from(schema.notifications).all().map((r) => r.delivered)).toEqual([2, 2]);
    expect(sent).toHaveLength(0);
  });
});

describe("subscription cleanup", () => {
  it("deletes subscriptions that answer 410 or 404 and keeps the rest", async () => {
    addSub("https://push.example.invalid/gone");
    addSub("https://push.example.invalid/missing");
    addSub("https://push.example.invalid/flaky");
    addSub("https://push.example.invalid/good");
    const failing: Sender = async (sub) => {
      if (sub.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (sub.endpoint.endsWith("/missing")) throw Object.assign(new Error("nf"), { statusCode: 404 });
      if (sub.endpoint.endsWith("/flaky")) throw Object.assign(new Error("boom"), { statusCode: 500 });
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sendPush({ title: "t", body: "b" }, { db, sender: failing, vapid: VAPID });
    expect(r).toMatchObject({ devices: 4, sent: 1, removed: 2, failed: 1 });
    expect(db.select().from(schema.pushSubscriptions).all().map((s) => s.endpoint).sort()).toEqual([
      "https://push.example.invalid/flaky",
      "https://push.example.invalid/good",
    ]);
  });

  it("works through the real web-push call path (mocked) with VAPID details", async () => {
    addSub("https://push.example.invalid/gone");
    vi.mocked(sendNotification).mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    const r = await sendPush({ title: "t", body: "b", url: "/digest", tag: "x" }, { db, vapid: VAPID });
    expect(r.removed).toBe(1);
    expect(db.select().from(schema.pushSubscriptions).all()).toHaveLength(0);
    const [sub, payload, options] = vi.mocked(sendNotification).mock.calls[0];
    expect((sub as { endpoint: string }).endpoint).toBe("https://push.example.invalid/gone");
    expect(JSON.parse(payload as string)).toEqual({ title: "t", body: "b", url: "/digest", tag: "x" });
    expect(options).toMatchObject({ vapidDetails: { subject: VAPID.subject } });
  });

  it("does not call the push service when there are no devices", async () => {
    await sendPush({ title: "t", body: "b" }, { db, vapid: VAPID });
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("deviceLabel", () => {
  it("names common devices", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1")).toBe("iPhone");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceLabel(null)).toBe("Unknown device");
  });
});

describe("ntfy channel", () => {
  const NTFY = { baseUrl: "https://ntfy.example.invalid", topic: "t-secret", appUrl: "https://app.example.invalid" };

  it("delivers through ntfy with no web push devices at all", async () => {
    const calls: { title: string; body: string; url: string }[] = [];
    const ntfySender = async (_cfg: unknown, p: { title: string; body: string; url: string }) => {
      calls.push(p);
    };
    const status = await notify(db, { kind: "goal", title: "Goal 25%", body: "b", url: "/dashboard", key: "goal:1:25" }, { now: NOON, vapid: null, ntfy: NTFY, ntfySender });
    expect(status).toBe("sent");
    expect(calls).toEqual([{ title: "Goal 25%", body: "b", url: "/dashboard", tag: undefined }]);
  });

  it("a failing ntfy does not block web push, and vice versa", async () => {
    addSub();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ntfySender = async () => {
      throw new Error("ntfy 500");
    };
    const r = await sendPush({ title: "t", body: "b" }, { db, sender, vapid: VAPID, ntfy: NTFY, ntfySender });
    expect(r).toMatchObject({ sent: 1, failed: 1 });
  });

  it("the default sender posts JSON with an absolute click url and bearer token", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendPush({ title: "Low balance", body: "b", url: "/settings/bank#replace" }, { db, vapid: null, ntfy: { ...NTFY, token: "tk" } });
    vi.unstubAllGlobals();
    expect(r.sent).toBe(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ntfy.example.invalid");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tk");
    expect(JSON.parse(init.body as string)).toMatchObject({ topic: "t-secret", title: "Low balance", click: "https://app.example.invalid/settings/bank#replace" });
  });

  it("is off when no topic is set", async () => {
    const r = await sendPush({ title: "t", body: "b" }, { db, vapid: null, ntfy: null });
    expect(r).toMatchObject({ configured: false, sent: 0 });
  });
});
