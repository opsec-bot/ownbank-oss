import { describe, expect, it } from "vitest";
import { schema } from "@/lib/db";
import { cryptoSplit, netWorthCents } from "@/lib/finance/networth";
import { computeSnapshot, netWorthChange, writeSnapshot } from "@/lib/finance/snapshots";
import { monthView, tradingFlows } from "@/lib/finance/stats";
import { STABLE_MINTS, analyzeTokens, parseDasPage, totalsFromPages } from "@/lib/solana/balances";
import { parseFlows, scanTradingFlows, valueFlowCents } from "@/lib/solana/flows";
import { addAccount, addTx, freshDb } from "../helpers/seed";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SAVINGS = "SavingsWallet1111111111111111111111111111111";
const TRADING = "TradingWallet1111111111111111111111111111111";

const das = (items: unknown[], sol = { lamports: 1_000_000_000, total_price: 100 }) => ({
  result: { items, nativeBalance: sol },
});

describe("stable / volatile split", () => {
  const items = [
    { id: USDC, token_info: { symbol: "USDC", balance: 5000000, decimals: 6, price_info: { price_per_token: 1, total_price: 50 } } },
    { id: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", token_info: { balance: 1, price_info: { price_per_token: 1, total_price: 20.25 } } },
    { id: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", token_info: { balance: 1, price_info: { price_per_token: 1, total_price: 5 } } },
    { id: "MEME", token_info: { symbol: "MEME", balance: 10, price_info: { price_per_token: 3, total_price: 30 } } },
    { id: "UNPRICED", token_info: { balance: 10 } },
  ];

  it("splits by mint, SOL and other priced tokens are volatile", () => {
    const t = totalsFromPages([parseDasPage(das(items))]);
    expect(t.stableUsdCents).toBe(7525);
    expect(t.volatileUsdCents).toBe(10000 + 3000);
    expect(t.stableUsdCents + t.volatileUsdCents).toBe(t.totalUsdCents);
    expect(t.unpricedCount).toBe(1);
    expect(Object.keys(STABLE_MINTS)).toHaveLength(3);
  });
  it("keeps top holdings sorted with symbols", () => {
    const t = totalsFromPages([parseDasPage(das(items))]);
    const top = JSON.parse(t.topHoldings) as { symbol: string; usdCents: number }[];
    expect(top.map((h) => h.symbol)).toEqual(["SOL", "USDC", "MEME", "USDT", "PYUSD"]);
    expect(top[0]).toEqual({ symbol: "SOL", usdCents: 10000 });
    expect(top[1]).toEqual({ symbol: "USDC", usdCents: 5000 });
  });
  it("collects token prices for valuing transfers", () => {
    const a = analyzeTokens(items);
    expect(a.prices.get("MEME")).toEqual({ usd: 3, symbol: "MEME" });
    expect(a.stableUsd).toBeCloseTo(75.25);
  });
});

describe("wallet roles and net worth", () => {
  const wallets = [
    { totalUsdCents: 10000, stableUsdCents: 4000, volatileUsdCents: 6000, role: "savings" as const },
    { totalUsdCents: 50000, stableUsdCents: 0, volatileUsdCents: 50000, role: "trading" as const },
    { totalUsdCents: 500, role: undefined }, // legacy row: counted as savings, all volatile
  ];
  it("excludes trading wallets from net worth and the savings split", () => {
    const acct = [{ type: "depository", balanceLedgerCents: 20000 }];
    expect(netWorthCents(acct, wallets)).toBe(20000 + 10000 + 500);
    expect(cryptoSplit(wallets)).toEqual({ stableCents: 4000, volatileCents: 6500, tradingCents: 50000 });
  });
});

describe("snapshots", () => {
  const NOW = Date.UTC(2025, 10, 18, 18, 0, 0);
  function seed() {
    const db = freshDb();
    addAccount(db, "A1", { available: 10000, ledger: 12000 });
    db.insert(schema.cryptoWallets)
      .values([
        { address: SAVINGS, role: "savings", totalUsdCents: 7000, stableUsdCents: 3000, volatileUsdCents: 4000 },
        { address: TRADING, role: "trading", totalUsdCents: 9000, stableUsdCents: 0, volatileUsdCents: 9000 },
      ])
      .run();
    return db;
  }
  it("computeSnapshot keeps trading for reference but out of the total", () => {
    const db = seed();
    const s = computeSnapshot(db.select().from(schema.accounts).all(), db.select().from(schema.cryptoWallets).all());
    expect(s).toEqual({ bankCents: 12000, cryptoStableCents: 3000, cryptoVolatileCents: 4000, cryptoTradingCents: 9000, totalCents: 19000 });
  });
  it("writes one row per day (upsert) and skips when there is nothing", () => {
    expect(writeSnapshot(freshDb(), NOW)).toBeNull();
    const db = seed();
    expect(writeSnapshot(db, NOW)).toBe("2025-11-18");
    db.update(schema.accounts).set({ balanceLedgerCents: 13000 }).run();
    writeSnapshot(db, NOW + 1000);
    const rows = db.select().from(schema.netWorthSnapshots).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].totalCents).toBe(20000);
  });
  it("changes vs yesterday and 30 days ago come from snapshots", () => {
    const db = seed();
    const row = (day: string, total: number) =>
      db.insert(schema.netWorthSnapshots).values({ day, bankCents: total, cryptoStableCents: 0, cryptoVolatileCents: 0, totalCents: total }).run();
    expect(netWorthChange(db, "2025-11-18", 20000)).toEqual({ change1dCents: null, change30dCents: null });
    row("2025-11-17", 19000);
    row("2025-10-19", 15000);
    row("2025-10-10", 1);
    expect(netWorthChange(db, "2025-11-18", 20000)).toEqual({ change1dCents: 1000, change30dCents: 5000 });
  });
});

describe("trading flows", () => {
  const savings = new Set([SAVINGS]);
  const trading = new Set([TRADING]);
  const keys = ["Payer", "SrcTok", "DstTok", SAVINGS, TRADING].map((pubkey) => ({ pubkey }));
  const balances = (idx: number, owner: string, mint: string) => ({ accountIndex: idx, mint, owner, uiTokenAmount: { decimals: 6 } });
  const tx = (ixs: unknown[]) => ({
    blockTime: 1_763_500_000,
    meta: { err: null, innerInstructions: [], preTokenBalances: [balances(1, SAVINGS, USDC), balances(2, TRADING, USDC)], postTokenBalances: [] },
    transaction: { message: { accountKeys: keys, instructions: ixs } },
  });

  it("detects SOL system transfers in both directions", () => {
    const ix = (source: string, destination: string) => ({ program: "system", parsed: { type: "transfer", info: { source, destination, lamports: 2_000_000_000 } } });
    expect(parseFlows(tx([ix(SAVINGS, TRADING)]), trading, savings)).toEqual([
      { from: SAVINGS, to: TRADING, mint: "SOL", amountRaw: "2000000000", decimals: 9, kind: "trading_funded" },
    ]);
    expect(parseFlows(tx([ix(TRADING, SAVINGS)]), trading, savings)[0].kind).toBe("trading_realized");
  });
  it("detects SPL transfers via token account owners and ignores unknown addresses", () => {
    const spl = { program: "spl-token", parsed: { type: "transferChecked", info: { source: "SrcTok", destination: "DstTok", tokenAmount: { amount: "5000000" } } } };
    const out = parseFlows(tx([spl]), trading, savings);
    expect(out).toEqual([{ from: SAVINGS, to: TRADING, mint: USDC, amountRaw: "5000000", decimals: 6, kind: "trading_funded" }]);
    const stranger = { program: "system", parsed: { type: "transfer", info: { source: "Stranger", destination: TRADING, lamports: 5 } } };
    expect(parseFlows(tx([stranger]), trading, savings)).toEqual([]);
    expect(parseFlows({ ...tx([spl]), meta: { err: { x: 1 } } }, trading, savings)).toEqual([]);
  });
  it("prices stable mints at $1, SOL and tokens from the market snapshot", () => {
    const market = { solUsd: 100, tokens: new Map([["MEME", { usd: 0.5, symbol: "MEME" }]]) };
    expect(valueFlowCents({ from: "a", to: "b", mint: "SOL", amountRaw: "2500000000", decimals: 9, kind: "trading_funded" }, market)).toEqual({ usdCents: 25000, symbol: "SOL" });
    expect(valueFlowCents({ from: "a", to: "b", mint: USDC, amountRaw: "12500000", decimals: 6, kind: "trading_funded" }, market)).toEqual({ usdCents: 1250, symbol: "USDC" });
    expect(valueFlowCents({ from: "a", to: "b", mint: "MEME", amountRaw: "4000000", decimals: 6, kind: "trading_realized" }, market).usdCents).toBe(200);
    expect(valueFlowCents({ from: "a", to: "b", mint: "UNKNOWNMINT", amountRaw: "4", decimals: 0, kind: "trading_realized" }, market).usdCents).toBe(0);
  });

  it("scanTradingFlows stores new flows, uses the cursor and caps getTransaction calls", async () => {
    const db = freshDb();
    db.insert(schema.cryptoWallets)
      .values([
        { address: SAVINGS, role: "savings" },
        { address: TRADING, role: "trading" },
      ])
      .run();
    const market = { solUsd: 100, tokens: new Map() };
    const calls: { method: string; params: unknown[] }[] = [];
    const sigList = Array.from({ length: 60 }, (_, i) => ({ signature: `SIG${String(59 - i).padStart(2, "0")}`, err: null, blockTime: 1_763_500_000 }));
    const fake = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { method: string; params: unknown[] };
      calls.push(body);
      if (body.method === "getSignaturesForAddress") return new Response(JSON.stringify({ result: sigList }));
      const sol = { program: "system", parsed: { type: "transfer", info: { source: SAVINGS, destination: TRADING, lamports: 1_000_000_000 } } };
      return new Response(JSON.stringify({ result: tx([sol]) }));
    };
    const now = 1_763_500_000_000 + 86400_000;
    const r = await scanTradingFlows(db, "https://rpc.invalid/?key=secret", market, fake, now);
    expect(r.fetched).toBe(50);
    expect(calls.filter((c) => c.method === "getTransaction")).toHaveLength(50);
    expect(db.select().from(schema.walletFlows).all()).toHaveLength(50);
    expect(db.select().from(schema.walletFlows).get()).toMatchObject({ kind: "trading_funded", symbol: "SOL", usdCents: 10000 });
    const cursor = db.select().from(schema.cryptoWallets).all().find((w) => w.role === "trading")!.lastSignature;
    expect(cursor).toBe("SIG49"); // oldest first: SIG00..SIG49 handled, the rest wait for the next refresh
  });

  it("flows count as spending (funded) and income-side (realized) in month stats", () => {
    const db = freshDb();
    addAccount(db, "A1");
    addTx(db, { date: "2025-11-03", amount: -5000, description: "FAKE DINER", category: "Dining" });
    const flow = (signature: string, day: string, kind: "trading_funded" | "trading_realized", usd: number) =>
      db.insert(schema.walletFlows).values({ signature, day, fromAddress: "a", toAddress: "b", mint: "SOL", symbol: "SOL", amountRaw: "1", usdCents: usd, kind }).run();
    flow("s1", "2025-11-04", "trading_funded", 20000);
    flow("s2", "2025-11-10", "trading_realized", 7000);
    flow("s3", "2025-10-30", "trading_funded", 99999);
    expect(tradingFlows(db, "2025-11-01", "2025-11-18")).toEqual({ fundedCents: 20000, realizedCents: 7000 });
    const m = monthView(db, "2025-11-18");
    expect(m.spendCents).toBe(25000);
    expect(m.categories[0]).toEqual({ name: "Memecoin trading", cents: 20000 });
    expect(m.realizedCents).toBe(7000);
  });
});
