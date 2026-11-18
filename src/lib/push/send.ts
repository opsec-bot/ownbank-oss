import { and, asc, desc, eq } from "drizzle-orm";
import { sendNotification } from "web-push";
import { getDb, schema, type DB } from "@/lib/db";
import { isQuietHours } from "./time";

export type PushKind =
  | "digest"
  | "income_save"
  | "low_balance"
  | "disconnect"
  | "large_tx"
  | "budget_pace"
  | "goal"
  | "test";

export const TOGGLE_KINDS: { kind: Exclude<PushKind, "test">; label: string }[] = [
  { kind: "digest", label: "Daily digest" },
  { kind: "income_save", label: "Income: move to savings" },
  { kind: "low_balance", label: "Low balance warning" },
  { kind: "disconnect", label: "Bank connection broken" },
  { kind: "large_tx", label: "Large transaction" },
  { kind: "budget_pace", label: "Budget alerts" },
  { kind: "goal", label: "Savings goal milestones" },
];

// settings column per kind (test is always allowed).
const TOGGLE_COLUMN = {
  digest: "pushDigest",
  income_save: "pushIncomeSave",
  low_balance: "pushLowBalance",
  disconnect: "pushDisconnect",
  large_tx: "pushLargeTx",
  budget_pace: "pushBudgetPace",
  goal: "pushGoal",
} as const;

// These go out even during quiet hours.
const QUIET_EXEMPT = new Set<PushKind>(["disconnect", "test"]);

// notifications.delivered values.
export const QUEUED = 0;
export const SENT = 1;
export const UNDELIVERABLE = 2; // no devices, push not configured, or every device failed
const SENDING = 3;

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };
export type VapidDetails = { subject: string; publicKey: string; privateKey: string };
export type Sender = (sub: PushSub, payload: string, vapid: VapidDetails) => Promise<unknown>;

export type DeliverResult = { configured: boolean; devices: number; sent: number; removed: number; failed: number };

export function vapidFromEnv(): VapidDetails | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { subject, publicKey, privateKey };
}

const defaultSender: Sender = (sub, payload, vapid) =>
  sendNotification(sub, payload, {
    vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    TTL: 60 * 60 * 12,
    urgency: "high",
  });

// ntfy: a second delivery channel for the native iOS app, which cannot receive APNs pushes (sideloaded builds lack the
// push entitlement). The server publishes to a private topic and the free ntfy iOS app shows it. The topic name is the
// secret, so use a long random one (or a token on a self-hosted server).
export type NtfyConfig = { baseUrl: string; topic: string; token?: string; appUrl: string };
export type NtfySender = (cfg: NtfyConfig, payload: Required<Pick<PushPayload, "title" | "body" | "url">> & { tag?: string }) => Promise<void>;

export function ntfyFromEnv(): NtfyConfig | null {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return null;
  return {
    baseUrl: (process.env.NTFY_URL || "https://ntfy.sh").replace(/\/+$/, ""),
    topic,
    token: process.env.NTFY_TOKEN || undefined,
    appUrl: (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
  };
}

// JSON publish keeps non-ASCII text out of HTTP headers.
const defaultNtfySender: NtfySender = async (cfg, p) => {
  const res = await fetch(cfg.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) },
    body: JSON.stringify({ topic: cfg.topic, title: p.title, message: p.body, click: `${cfg.appUrl}${p.url}`, tags: ["bank"], priority: 4 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
};

export type SendOpts = { db?: DB; sender?: Sender; vapid?: VapidDetails | null; ntfy?: NtfyConfig | null; ntfySender?: NtfySender };

// Sends to every stored device. Subscriptions the push service reports gone (404/410) are deleted.
export async function sendPush(payload: PushPayload, opts: SendOpts = {}): Promise<DeliverResult> {
  const db = opts.db ?? getDb();
  const subs = db.select().from(schema.pushSubscriptions).all();
  const vapid = opts.vapid === undefined ? vapidFromEnv() : opts.vapid;
  const ntfy = opts.ntfy === undefined ? ntfyFromEnv() : opts.ntfy;
  const result: DeliverResult = { configured: vapid !== null || ntfy !== null, devices: subs.length, sent: 0, removed: 0, failed: 0 };
  const url = payload.url ?? "/dashboard";
  if (ntfy) {
    try {
      await (opts.ntfySender ?? defaultNtfySender)(ntfy, { title: payload.title, body: payload.body, url, tag: payload.tag });
      result.sent++;
    } catch (e) {
      result.failed++;
      console.error("ntfy send failed:", e instanceof Error ? e.message : "error");
    }
  }
  if (!vapid || subs.length === 0) return result;
  const send = opts.sender ?? defaultSender;
  const body = JSON.stringify({ title: payload.title, body: payload.body, url, tag: payload.tag });
  for (const s of subs) {
    try {
      await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, vapid);
      result.sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, s.endpoint)).run();
        result.removed++;
      } else {
        result.failed++;
        console.error("push send failed:", status ?? "network error");
      }
    }
  }
  return result;
}

export type NotifyInput = PushPayload & {
  kind: PushKind;
  key?: string; // stable dedupe key: the same key is never sent twice
};
export type NotifyStatus = "sent" | "queued" | "duplicate" | "disabled" | "undelivered";

function kindEnabled(db: DB, kind: PushKind): boolean {
  if (kind === "test") return true;
  const s = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get();
  if (!s) return true; // no settings row yet: defaults are all on
  return s[TOGGLE_COLUMN[kind]];
}

// The one entry point for every alert: checks the per-kind toggle, dedupes by key, logs to notifications, and either
// sends now or queues until quiet hours end (disconnect and test ignore quiet hours).
export async function notify(db: DB, n: NotifyInput, opts: { now?: number; sender?: Sender; vapid?: VapidDetails | null; ntfy?: NtfyConfig | null; ntfySender?: NtfySender } = {}): Promise<NotifyStatus> {
  const now = opts.now ?? Date.now();
  if (!kindEnabled(db, n.kind)) return "disabled";
  const queue = isQuietHours(now) && !QUIET_EXEMPT.has(n.kind);
  const inserted = db
    .insert(schema.notifications)
    .values({
      kind: n.kind,
      title: n.title,
      body: n.body,
      url: n.url ?? "/dashboard",
      tag: n.tag ?? null,
      dedupeKey: n.key ?? null,
      createdAt: now,
      delivered: queue ? QUEUED : SENDING,
    })
    .onConflictDoNothing()
    .returning({ id: schema.notifications.id })
    .get();
  if (!inserted) return "duplicate";
  if (queue) return "queued";
  const r = await sendPush(n, { db, sender: opts.sender, vapid: opts.vapid, ntfy: opts.ntfy, ntfySender: opts.ntfySender });
  const ok = r.sent > 0;
  db.update(schema.notifications)
    .set({ delivered: ok ? SENT : UNDELIVERABLE })
    .where(eq(schema.notifications.id, inserted.id))
    .run();
  return ok ? "sent" : "undelivered";
}

export function queuedCount(db: DB): number {
  return db.select({ id: schema.notifications.id }).from(schema.notifications).where(eq(schema.notifications.delivered, QUEUED)).all().length;
}

// Sends everything queued during quiet hours. Does nothing while quiet hours are still on.
export async function flushQueued(db: DB, now = Date.now(), opts: { sender?: Sender; vapid?: VapidDetails | null; ntfy?: NtfyConfig | null; ntfySender?: NtfySender } = {}): Promise<number> {
  if (isQuietHours(now)) return 0;
  const rows = db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.delivered, QUEUED))
    .orderBy(asc(schema.notifications.id))
    .all();
  let n = 0;
  for (const row of rows) {
    // Claim the row first so an overlapping tick cannot send it twice.
    const claimed = db
      .update(schema.notifications)
      .set({ delivered: SENDING })
      .where(and(eq(schema.notifications.id, row.id), eq(schema.notifications.delivered, QUEUED)))
      .returning({ id: schema.notifications.id })
      .get();
    if (!claimed) continue;
    const r = await sendPush({ title: row.title, body: row.body, url: row.url, tag: row.tag ?? undefined }, { db, ...opts });
    db.update(schema.notifications)
      .set({ delivered: r.sent > 0 ? SENT : UNDELIVERABLE })
      .where(eq(schema.notifications.id, row.id))
      .run();
    n++;
  }
  return n;
}

export function recentNotifications(db: DB, limit = 15) {
  return db.select().from(schema.notifications).orderBy(desc(schema.notifications.id)).limit(limit).all();
}
