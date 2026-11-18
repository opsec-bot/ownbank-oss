import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema, type DB } from "@/lib/db";

// Wallet balances for net worth only. Helius DAS getAssetsByOwner prices SOL and fungible tokens.
// The RPC URL embeds the API key: never log it, never include it in error messages.

const PAGE_LIMIT = 1000;
const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 30_000;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidSolanaAddress(address: string): boolean {
  return BASE58.test(address);
}

// Stablecoins counted as "stable" savings, by mint.
export const STABLE_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": "PYUSD",
};

export type Holding = { symbol: string; usdCents: number };

export type WalletTotals = {
  solLamports: number;
  solUsdCents: number;
  tokensUsdCents: number;
  totalUsdCents: number;
  unpricedCount: number;
  stableUsdCents: number;
  volatileUsdCents: number; // SOL + every other priced token; stable + volatile = total
  topHoldings: string; // json Holding[] (top 8 by value)
};

// Prices seen while fetching wallets, used to value on-chain transfers (approximate, current price).
export type MarketPrices = {
  solUsd: number | null;
  tokens: Map<string, { usd: number; symbol: string }>;
};

type DasPage = {
  items: unknown[];
  nativeLamports: number | null;
  nativeUsd: number | null;
};

function toCents(usd: unknown): number {
  return typeof usd === "number" && Number.isFinite(usd) ? Math.round(usd * 100) : 0;
}

// Reads one getAssetsByOwner JSON-RPC response.
export function parseDasPage(json: unknown): DasPage {
  const root = json as { error?: { message?: unknown }; result?: Record<string, unknown> } | null;
  if (!root || typeof root !== "object") throw new Error("Unexpected response from Helius");
  if (root.error) {
    const m = typeof root.error.message === "string" ? root.error.message : "RPC error";
    throw new Error(`Helius error: ${m}`.slice(0, 200));
  }
  const result = root.result;
  if (!result || !Array.isArray(result.items)) throw new Error("Unexpected response from Helius");
  const nb = result.nativeBalance as { lamports?: unknown; total_price?: unknown } | undefined;
  return {
    items: result.items,
    nativeLamports: nb && typeof nb.lamports === "number" ? nb.lamports : null,
    nativeUsd: nb && typeof nb.total_price === "number" ? nb.total_price : null,
  };
}

// Sums token USD value over fungible items with a positive balance; counts those without a price.
export function sumTokens(items: unknown[]): { usd: number; unpriced: number } {
  let usd = 0;
  let unpriced = 0;
  for (const raw of items) {
    const info = (raw as { token_info?: { balance?: unknown; price_info?: { total_price?: unknown } } } | null)?.token_info;
    if (!info) continue; // NFTs and other non-fungible assets have no token_info
    const balance = typeof info.balance === "number" ? info.balance : Number(info.balance);
    if (!(balance > 0)) continue;
    const price = info.price_info?.total_price;
    if (typeof price === "number" && Number.isFinite(price)) usd += price;
    else unpriced++;
  }
  return { usd, unpriced };
}

function tokenSymbol(raw: unknown, mint: string): string {
  const a = raw as { token_info?: { symbol?: unknown }; content?: { metadata?: { symbol?: unknown } } } | null;
  const sym = a?.token_info?.symbol ?? a?.content?.metadata?.symbol;
  if (typeof sym === "string" && sym.trim()) return sym.trim().slice(0, 12);
  return STABLE_MINTS[mint] ?? mint.slice(0, 4);
}

// Per-token detail: stable USD, holdings list, and price per token (for valuing transfers).
export function analyzeTokens(items: unknown[]): {
  stableUsd: number;
  holdings: { symbol: string; usd: number }[];
  prices: Map<string, { usd: number; symbol: string }>;
} {
  let stableUsd = 0;
  const holdings: { symbol: string; usd: number }[] = [];
  const prices = new Map<string, { usd: number; symbol: string }>();
  for (const raw of items) {
    const a = raw as { id?: unknown; token_info?: { balance?: unknown; price_info?: { total_price?: unknown; price_per_token?: unknown } } } | null;
    const info = a?.token_info;
    if (!info) continue;
    const mint = typeof a?.id === "string" ? a.id : "";
    const symbol = tokenSymbol(raw, mint);
    const per = info.price_info?.price_per_token;
    if (mint && typeof per === "number" && Number.isFinite(per)) prices.set(mint, { usd: per, symbol });
    const balance = typeof info.balance === "number" ? info.balance : Number(info.balance);
    const total = info.price_info?.total_price;
    if (!(balance > 0) || typeof total !== "number" || !Number.isFinite(total)) continue;
    if (mint in STABLE_MINTS) stableUsd += total;
    holdings.push({ symbol, usd: total });
  }
  return { stableUsd, holdings, prices };
}

export function totalsFromPages(pages: DasPage[]): WalletTotals {
  let lamports = 0;
  let solUsd = 0;
  let tokens = 0;
  let unpriced = 0;
  for (const p of pages) {
    if (p.nativeLamports !== null) {
      lamports = p.nativeLamports;
      solUsd = p.nativeUsd ?? 0;
    }
    const s = sumTokens(p.items);
    tokens += s.usd;
    unpriced += s.unpriced;
  }
  const solUsdCents = toCents(solUsd);
  const tokensUsdCents = toCents(tokens);
  const totalUsdCents = solUsdCents + tokensUsdCents;
  let stable = 0;
  const holdings: { symbol: string; usd: number }[] = [];
  for (const p of pages) {
    const t = analyzeTokens(p.items);
    stable += t.stableUsd;
    holdings.push(...t.holdings);
  }
  if (solUsdCents > 0) holdings.push({ symbol: "SOL", usd: solUsd });
  const stableUsdCents = Math.min(toCents(stable), totalUsdCents);
  const top: Holding[] = holdings
    .map((h) => ({ symbol: h.symbol, usdCents: toCents(h.usd) }))
    .filter((h) => h.usdCents > 0)
    .sort((a, b) => b.usdCents - a.usdCents)
    .slice(0, 8);
  return {
    solLamports: lamports,
    solUsdCents,
    tokensUsdCents,
    totalUsdCents,
    unpricedCount: unpriced,
    stableUsdCents,
    volatileUsdCents: totalUsdCents - stableUsdCents,
    topHoldings: JSON.stringify(top),
  };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function fetchWalletTotals(address: string, rpcUrl: string, fetchImpl: FetchLike = fetch): Promise<WalletTotals> {
  return (await fetchWalletData(address, rpcUrl, fetchImpl)).totals;
}

export async function fetchWalletData(
  address: string,
  rpcUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ totals: WalletTotals; market: MarketPrices }> {
  const pages: DasPage[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "ownbank/1.0" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "ownbank",
          method: "getAssetsByOwner",
          params: {
            ownerAddress: address,
            page,
            limit: PAGE_LIMIT,
            displayOptions: { showFungible: true, showNativeBalance: true },
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new Error("Could not reach Helius");
    }
    if (!res.ok) throw new Error(`Helius request failed (HTTP ${res.status})`);
    // Decode explicitly as UTF-8 (token names can contain non-ASCII text).
    const text = Buffer.from(await res.arrayBuffer()).toString("utf8");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Helius returned invalid JSON");
    }
    const parsed = parseDasPage(json);
    pages.push(parsed);
    if (parsed.items.length < PAGE_LIMIT) break;
  }
  const market: MarketPrices = { solUsd: null, tokens: new Map() };
  for (const p of pages) {
    if (p.nativeLamports && p.nativeLamports > 0 && p.nativeUsd !== null) market.solUsd = (p.nativeUsd / p.nativeLamports) * 1e9;
    for (const [mint, v] of analyzeTokens(p.items).prices) market.tokens.set(mint, v);
  }
  return { totals: totalsFromPages(pages), market };
}

// Refreshes every wallet. One wallet failing does not stop the others. No-op without HELIUS_RPC_URL.
export async function refreshAllWallets(db: DB = getDb(), fetchImpl: FetchLike = fetch): Promise<void> {
  const rpcUrl = process.env.HELIUS_RPC_URL;
  if (!rpcUrl) return;
  const wallets = db.select().from(schema.cryptoWallets).all();
  const market: MarketPrices = { solUsd: null, tokens: new Map() };
  for (const w of wallets) {
    try {
      const data = await fetchWalletData(w.address, rpcUrl, fetchImpl);
      if (data.market.solUsd !== null) market.solUsd = data.market.solUsd;
      for (const [k, v] of data.market.tokens) market.tokens.set(k, v);
      db.update(schema.cryptoWallets)
        .set({ ...data.totals, updatedAt: Date.now(), lastError: null })
        .where(eq(schema.cryptoWallets.id, w.id))
        .run();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Refresh failed";
      db.update(schema.cryptoWallets)
        .set({ lastError: message.slice(0, 300) })
        .where(eq(schema.cryptoWallets.id, w.id))
        .run();
    }
  }
  // Trading flows: a failure here never fails the balance refresh.
  try {
    const { scanTradingFlows } = await import("./flows");
    await scanTradingFlows(db, rpcUrl, market, fetchImpl);
  } catch (e) {
    console.error("trading flow scan failed:", e instanceof Error ? e.message.replace(rpcUrl, "[rpc]") : "unknown error");
  }
}

// Used right after adding a wallet so it shows a total without waiting for the next sync.
export async function refreshWalletById(id: number, db: DB = getDb()): Promise<void> {
  const rpcUrl = process.env.HELIUS_RPC_URL;
  const w = db.select().from(schema.cryptoWallets).where(eq(schema.cryptoWallets.id, id)).get();
  if (!w) return;
  if (!rpcUrl) {
    db.update(schema.cryptoWallets).set({ lastError: "HELIUS_RPC_URL is not set" }).where(eq(schema.cryptoWallets.id, id)).run();
    return;
  }
  try {
    const totals = await fetchWalletTotals(w.address, rpcUrl);
    db.update(schema.cryptoWallets).set({ ...totals, updatedAt: Date.now(), lastError: null }).where(eq(schema.cryptoWallets.id, id)).run();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Refresh failed";
    db.update(schema.cryptoWallets).set({ lastError: message.slice(0, 300) }).where(eq(schema.cryptoWallets.id, id)).run();
  }
}
