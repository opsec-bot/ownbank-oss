import "server-only";
import { createHash } from "node:crypto";

// SimpleFIN Bridge client. The access URL (https://USER:PASS@host/simplefin) is a secret:
// it is only ever held in memory here and stored encrypted by the caller. Never log it or send it to the browser.

export const USER_AGENT = "ownbank/1.0";
const REQUEST_TIMEOUT_MS = 30_000;
// The bridge rejects ranges over 45 days ("exceeds recommended range of 45 days"), so long windows are split.
export const MAX_REQUEST_SECONDS = 45 * 86400 - 60;

// Splits [start, end] into consecutive chunks of at most maxSeconds, newest first.
export function splitWindow(start: number, end: number, maxSeconds = MAX_REQUEST_SECONDS): [number, number][] {
  const out: [number, number][] = [];
  let hi = end;
  while (hi > start) {
    const lo = Math.max(start, hi - maxSeconds);
    out.push([lo, hi]);
    hi = lo;
  }
  return out.length ? out : [[start, end]];
}

// Merges chunk results (newest first): balances from the newest chunk, transactions de-duplicated by id.
export function mergeResults(parts: SfResult[]): SfResult {
  const [first, ...rest] = parts;
  const accounts = first.accounts.map((a) => ({ ...a, transactions: [...a.transactions] }));
  for (const part of rest) {
    for (const pa of part.accounts) {
      const mine = accounts.find((a) => a.id === pa.id);
      if (!mine) {
        accounts.push({ ...pa, transactions: [...pa.transactions] });
        continue;
      }
      const seen = new Set(mine.transactions.map((t) => t.id));
      for (const t of pa.transactions) if (!seen.has(t.id)) mine.transactions.push(t);
    }
  }
  return { accounts, connectionNames: first.connectionNames };
}

export class SimpleFinError extends Error {
  // "auth" = token/credentials rejected or bridge reports a broken connection. "api" = other bad response.
  // "request" = the bridge refused this particular request (for example a date range that is too long): the
  // connection itself is fine, so it is not marked broken.
  constructor(
    message: string,
    readonly kind: "auth" | "api" | "network" | "request",
  ) {
    super(message);
    this.name = "SimpleFinError";
  }
}

// ---------- pure helpers (unit tested) ----------

// "68.58" -> 6858, "-12.3" -> -1230, "12" -> 1200. Exact string math, no floats. Extra decimals round half away from zero.
export function parseMoneyToCents(input: string | number): number {
  const s = String(input).trim();
  const m = /^([+-])?(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error("Invalid money amount");
  const neg = m[1] === "-";
  const whole = m[2];
  const frac = m[3] ?? "";
  const cents = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  let total = cents;
  if (frac.length > 2 && frac.charCodeAt(2) >= 53 /* '5' */) total += 1n;
  const n = Number(neg ? -total : total);
  if (!Number.isSafeInteger(n)) throw new Error("Money amount out of range");
  return n === 0 ? 0 : n; // avoid -0
}

// Account names look like "Fake Checking- 1234 (1234)". Returns at most 4 digits.
export function extractLastFour(name: string): string | null {
  const paren = /\(\D*\d*?(\d{4})\)/.exec(name);
  if (paren) return paren[1];
  const dash = /-\s*(?:x+|\*+)?(\d{4})\b/i.exec(name);
  if (dash) return dash[1];
  return null;
}

export function guessAccountType(name: string): "credit" | "depository" {
  return /credit|card|visa|mastercard/i.test(name) ? "credit" : "depository";
}

export function decodeSetupToken(token: string): string {
  const cleaned = token.replace(/\s+/g, "");
  if (!cleaned) throw new SimpleFinError("Setup token is empty", "api");
  const claimUrl = Buffer.from(cleaned, "base64").toString("utf8").trim();
  let url: URL;
  try {
    url = new URL(claimUrl);
  } catch {
    throw new SimpleFinError("Setup token is not valid", "api");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SimpleFinError("Setup token is not valid", "api");
  return claimUrl;
}

export function splitAccessUrl(accessUrl: string): { base: string; authHeader: string } {
  const u = new URL(accessUrl.trim());
  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);
  u.username = "";
  u.password = "";
  u.search = "";
  u.hash = "";
  const base = u.toString().replace(/\/+$/, "");
  return { base, authHeader: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") };
}

// Stable, non-secret id for a connection: hash of host + username only (never the password).
export function providerConnectionId(accessUrl: string): string {
  const u = new URL(accessUrl.trim());
  return createHash("sha256").update(`${u.host}|${decodeURIComponent(u.username)}`).digest("hex").slice(0, 32);
}

export type SfTransaction = {
  id: string;
  posted: number; // unix seconds, 0 when pending
  transactedAt: number | null;
  amountCents: number;
  description: string;
  payee: string | null;
  memo: string | null;
  pending: boolean;
  mcc: string | null;
};

export type SfAccount = {
  id: string;
  name: string;
  currency: string;
  balanceCents: number;
  availableBalanceCents: number | null;
  balanceDate: number | null; // unix seconds
  orgName: string | null;
  transactions: SfTransaction[];
};

export type SfResult = {
  accounts: SfAccount[];
  connectionNames: string[];
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Collects human readable problems from `errors` (strings) and `errlist` (objects with msg).
export function collectErrors(json: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (Array.isArray(json.errors)) {
    for (const e of json.errors) {
      if (typeof e === "string" && e) out.push(e);
      else if (e && typeof e === "object" && typeof (e as { msg?: unknown }).msg === "string") out.push((e as { msg: string }).msg);
    }
  }
  if (Array.isArray(json.errlist)) {
    for (const e of json.errlist) {
      if (e && typeof e === "object") {
        const o = e as { code?: unknown; msg?: unknown };
        const msg = typeof o.msg === "string" ? o.msg : "";
        const code = typeof o.code === "string" ? o.code : "";
        if (msg || code) out.push([code, msg].filter(Boolean).join(": "));
      }
    }
  }
  return [...new Set(out)];
}

export function parseAccountsResponse(json: unknown): SfResult {
  if (!json || typeof json !== "object") throw new SimpleFinError("Unexpected response from SimpleFIN", "api");
  const root = json as Record<string, unknown>;
  const errors = collectErrors(root);
  if (errors.length) {
    const requestLevel = errors.every((e) => /^gen\./.test(e) || /date range/i.test(e));
    throw new SimpleFinError(errors.join("; ").slice(0, 500), requestLevel ? "request" : "auth");
  }
  if (!Array.isArray(root.accounts)) throw new SimpleFinError("Unexpected response from SimpleFIN", "api");

  const connectionNames: string[] = [];
  if (Array.isArray(root.connections)) {
    for (const c of root.connections) {
      const n = c && typeof c === "object" ? str((c as { name?: unknown }).name) : null;
      if (n) connectionNames.push(n);
    }
  }

  const accounts: SfAccount[] = [];
  for (const raw of root.accounts as Record<string, unknown>[]) {
    const id = str(raw.id);
    if (!id) continue;
    const name = str(raw.name) ?? "Account";
    const org = raw.org && typeof raw.org === "object" ? (raw.org as Record<string, unknown>) : {};
    const txs: SfTransaction[] = [];
    if (Array.isArray(raw.transactions)) {
      for (const t of raw.transactions as Record<string, unknown>[]) {
        const tid = str(t.id);
        if (!tid || t.amount === undefined || t.amount === null) continue;
        const posted = num(t.posted) ?? 0;
        const mcc = t.mcc === undefined || t.mcc === null || t.mcc === "" ? null : String(t.mcc);
        txs.push({
          id: tid,
          posted,
          transactedAt: num(t.transacted_at),
          amountCents: parseMoneyToCents(t.amount as string | number),
          description: str(t.description) ?? "",
          payee: str(t.payee),
          memo: str(t.memo),
          pending: t.pending === true || posted === 0,
          mcc,
        });
      }
    }
    accounts.push({
      id,
      name,
      currency: str(raw.currency) ?? "USD",
      balanceCents: raw.balance === undefined || raw.balance === null ? 0 : parseMoneyToCents(raw.balance as string | number),
      availableBalanceCents:
        raw["available-balance"] === undefined || raw["available-balance"] === null
          ? null
          : parseMoneyToCents(raw["available-balance"] as string | number),
      balanceDate: num(raw["balance-date"]),
      orgName: str(org.name) ?? str(org.domain),
      transactions: txs,
    });
  }
  return { accounts, connectionNames };
}

// ---------- network ----------

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: { "User-Agent": USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new SimpleFinError("Could not reach SimpleFIN", "network");
  }
}

// One-time claim. Returns the access URL (secret). A setup token can only be claimed once.
export async function claimSetupToken(setupToken: string): Promise<string> {
  const claimUrl = decodeSetupToken(setupToken);
  const res = await request(claimUrl, { method: "POST", headers: { "Content-Length": "0" } });
  if (res.status === 403 || res.status === 404 || res.status === 410) {
    throw new SimpleFinError("Setup token was rejected (already used or expired). Make a new one.", "auth");
  }
  if (!res.ok) throw new SimpleFinError(`SimpleFIN claim failed (HTTP ${res.status})`, "api");
  const accessUrl = (await res.text()).trim();
  try {
    const u = new URL(accessUrl);
    if (!u.username || !u.password) throw new Error();
  } catch {
    throw new SimpleFinError("SimpleFIN returned an unexpected claim response", "api");
  }
  return accessUrl;
}

export async function fetchAccounts(
  accessUrl: string,
  opts: { startDate: number; endDate: number; pending?: boolean },
): Promise<SfResult> {
  if (opts.endDate - opts.startDate > MAX_REQUEST_SECONDS + 60) {
    throw new SimpleFinError("Date window is longer than 45 days", "request");
  }
  const { base, authHeader } = splitAccessUrl(accessUrl);
  const qs = new URLSearchParams({
    version: "2",
    "start-date": String(Math.floor(opts.startDate)),
    "end-date": String(Math.floor(opts.endDate)),
  });
  if (opts.pending !== false) qs.set("pending", "1");
  const res = await request(`${base}/accounts?${qs}`, { method: "GET", headers: { Authorization: authHeader } });
  if (res.status === 401 || res.status === 403) {
    throw new SimpleFinError(`SimpleFIN rejected the credentials (HTTP ${res.status}). Replace the connection.`, "auth");
  }
  if (!res.ok) throw new SimpleFinError(`SimpleFIN request failed (HTTP ${res.status})`, "api");
  let json: unknown;
  try {
    json = JSON.parse(await res.text());
  } catch {
    throw new SimpleFinError("SimpleFIN returned invalid JSON", "api");
  }
  return parseAccountsResponse(json);
}
