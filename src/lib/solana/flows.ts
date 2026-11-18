import "server-only";
import { eq } from "drizzle-orm";
import { localDate } from "@/lib/bank/normalize";
import { schema, type DB } from "@/lib/db";
import { STABLE_MINTS, type MarketPrices } from "./balances";

// Detects transfers between the owner's savings wallets and trading wallets.
// savings -> trading = trading_funded (counts as spending), trading -> savings = trading_realized (income).
// Everything else (swaps, unknown addresses) is ignored. Values use the price seen at refresh time (approximate).

export const MAX_TX_PER_REFRESH = 50;
export const SIGNATURE_LIMIT = 50;
export const FIRST_RUN_LOOKBACK_DAYS = 30;
const REQUEST_TIMEOUT_MS = 30_000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type RawFlow = {
  from: string;
  to: string;
  mint: string; // "SOL" for native
  amountRaw: string;
  decimals: number;
  kind: "trading_funded" | "trading_realized";
};

type ParsedIx = { program?: string; parsed?: { type?: string; info?: Record<string, unknown> } };
type TokenBal = { accountIndex: number; mint: string; owner?: string; uiTokenAmount?: { decimals?: number } };

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// Pure: pulls savings<->trading transfers out of one jsonParsed transaction.
export function parseFlows(tx: unknown, tradingAddrs: Set<string>, savingsAddrs: Set<string>): RawFlow[] {
  const t = tx as {
    meta?: {
      err?: unknown;
      innerInstructions?: { instructions?: ParsedIx[] }[];
      preTokenBalances?: TokenBal[];
      postTokenBalances?: TokenBal[];
    };
    transaction?: { message?: { accountKeys?: ({ pubkey?: string } | string)[]; instructions?: ParsedIx[] } };
  } | null;
  const msg = t?.transaction?.message;
  if (!t || !msg || t.meta?.err) return [];

  const keys = (msg.accountKeys ?? []).map((k) => (typeof k === "string" ? k : (k.pubkey ?? "")));
  const tokenAcct = new Map<string, { owner: string; mint: string; decimals: number }>();
  for (const b of [...(t.meta?.preTokenBalances ?? []), ...(t.meta?.postTokenBalances ?? [])]) {
    const key = keys[b.accountIndex];
    if (key && b.owner) tokenAcct.set(key, { owner: b.owner, mint: b.mint, decimals: b.uiTokenAmount?.decimals ?? 0 });
  }

  const direction = (from: string, to: string): RawFlow["kind"] | null => {
    if (savingsAddrs.has(from) && tradingAddrs.has(to)) return "trading_funded";
    if (tradingAddrs.has(from) && savingsAddrs.has(to)) return "trading_realized";
    return null;
  };

  const ixs: ParsedIx[] = [
    ...(msg.instructions ?? []),
    ...(t.meta?.innerInstructions ?? []).flatMap((i) => i.instructions ?? []),
  ];
  const out: RawFlow[] = [];
  for (const ix of ixs) {
    const type = ix.parsed?.type;
    const info = ix.parsed?.info;
    if (!type || !info) continue;
    if (ix.program === "system" && type === "transfer") {
      const from = str(info.source);
      const to = str(info.destination);
      const lamports = typeof info.lamports === "number" ? info.lamports : Number(info.lamports);
      const kind = from && to ? direction(from, to) : null;
      if (kind && from && to && lamports > 0) {
        out.push({ from, to, mint: "SOL", amountRaw: String(lamports), decimals: 9, kind });
      }
    } else if (
      (ix.program === "spl-token" || ix.program === "spl-token-2022") &&
      (type === "transfer" || type === "transferChecked")
    ) {
      const src = tokenAcct.get(str(info.source) ?? "");
      const dst = tokenAcct.get(str(info.destination) ?? "");
      if (!src || !dst) continue;
      const kind = direction(src.owner, dst.owner);
      const ta = info.tokenAmount as { amount?: unknown } | undefined;
      const amount = str(info.amount) ?? str(ta?.amount);
      if (kind && amount && /^\d+$/.test(amount) && amount !== "0") {
        out.push({ from: src.owner, to: dst.owner, mint: src.mint, amountRaw: amount, decimals: src.decimals, kind });
      }
    }
  }
  return out;
}

export function valueFlowCents(f: RawFlow, market: MarketPrices): { usdCents: number; symbol: string } {
  const amount = Number(f.amountRaw) / 10 ** f.decimals;
  if (f.mint === "SOL") return { usdCents: market.solUsd ? Math.round(amount * market.solUsd * 100) : 0, symbol: "SOL" };
  const stable = STABLE_MINTS[f.mint];
  if (stable) return { usdCents: Math.round(amount * 100), symbol: stable };
  const p = market.tokens.get(f.mint);
  return { usdCents: p ? Math.round(amount * p.usd * 100) : 0, symbol: p?.symbol ?? f.mint.slice(0, 4) };
}

async function rpc(url: string, method: string, params: unknown[], fetchImpl: FetchLike): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "ownbank/1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "ownbank", method, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new Error("Could not reach Helius");
  }
  if (!res.ok) throw new Error(`Helius request failed (HTTP ${res.status})`);
  const json = JSON.parse(Buffer.from(await res.arrayBuffer()).toString("utf8")) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (json.error) throw new Error(`Helius error: ${String(json.error.message ?? "RPC error").slice(0, 120)}`);
  return json.result;
}

// maxSupportedTransactionVersion 0 first; a node that meets a newer transaction format says so, so retry once with 1.
// Any other failure on a single transaction is skipped: one odd transaction must not block the whole scan.
async function getParsedTransaction(url: string, signature: string, fetchImpl: FetchLike): Promise<{ blockTime?: number | null } | null> {
  for (const version of [0, 1]) {
    try {
      return (await rpc(url, "getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: version }], fetchImpl)) as {
        blockTime?: number | null;
      } | null;
    } catch (e) {
      const unsupported = e instanceof Error && /version/i.test(e.message);
      if (!unsupported || version === 1) return null;
    }
  }
  return null;
}

type SigInfo = { signature: string; err: unknown; blockTime?: number | null };

// Scans every trading wallet once. At most 50 getTransaction calls per call; first run looks back 30 days.
export async function scanTradingFlows(
  db: DB,
  rpcUrl: string,
  market: MarketPrices,
  fetchImpl: FetchLike = fetch,
  now = Date.now(),
): Promise<{ fetched: number; stored: number }> {
  const wallets = db.select().from(schema.cryptoWallets).all();
  const trading = wallets.filter((w) => w.role === "trading");
  const savings = new Set(wallets.filter((w) => w.role === "savings").map((w) => w.address));
  const tradingAddrs = new Set(trading.map((w) => w.address));
  let budget = MAX_TX_PER_REFRESH;
  let fetched = 0;
  let stored = 0;
  if (trading.length === 0 || savings.size === 0) return { fetched, stored };
  const cutoff = Math.floor(now / 1000) - FIRST_RUN_LOOKBACK_DAYS * 86400;

  for (const w of trading) {
    const opts: Record<string, unknown> = { limit: SIGNATURE_LIMIT };
    if (w.lastSignature) opts.until = w.lastSignature;
    const sigs = (await rpc(rpcUrl, "getSignaturesForAddress", [w.address, opts], fetchImpl)) as SigInfo[];
    // Newest first from the RPC; process oldest first so the cursor only moves past what we handled.
    const fresh = sigs.filter((s) => !s.err && (w.lastSignature || !s.blockTime || s.blockTime >= cutoff)).reverse();
    let newest: string | null = null;
    for (const s of fresh) {
      if (budget <= 0) break;
      budget--;
      fetched++;
      const tx = await getParsedTransaction(rpcUrl, s.signature, fetchImpl);
      newest = s.signature;
      if (!tx) continue;
      const flows = parseFlows(tx, tradingAddrs, savings);
      const blockTime = tx.blockTime ?? s.blockTime ?? Math.floor(now / 1000);
      flows.forEach((f, i) => {
        const v = valueFlowCents(f, market);
        db.insert(schema.walletFlows)
          .values({
            signature: i === 0 ? s.signature : `${s.signature}#${i}`,
            day: localDate(blockTime),
            fromAddress: f.from,
            toAddress: f.to,
            mint: f.mint,
            symbol: v.symbol,
            amountRaw: f.amountRaw,
            usdCents: v.usdCents,
            kind: f.kind,
          })
          .onConflictDoNothing()
          .run();
        stored++;
      });
    }
    // A first run with nothing in range still sets a cursor so later runs do not look back again.
    const cursor = newest ?? (!w.lastSignature && sigs.length ? sigs[0].signature : null);
    if (cursor) db.update(schema.cryptoWallets).set({ lastSignature: cursor }).where(eq(schema.cryptoWallets.id, w.id)).run();
  }
  return { fetched, stored };
}
