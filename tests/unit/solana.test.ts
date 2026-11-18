import { describe, expect, it } from "vitest";
import fixture from "../fixtures/helius-assets.json";
import { fetchWalletTotals, isValidSolanaAddress, parseDasPage, sumTokens, totalsFromPages } from "@/lib/solana/balances";

describe("isValidSolanaAddress", () => {
  it("accepts base58 of 32-44 chars", () => {
    expect(isValidSolanaAddress("So11111111111111111111111111111111111111112")).toBe(true);
    expect(isValidSolanaAddress("11111111111111111111111111111111")).toBe(true);
  });
  it("rejects bad input", () => {
    expect(isValidSolanaAddress("short")).toBe(false);
    expect(isValidSolanaAddress("0OIl" + "a".repeat(40))).toBe(false); // 0, O, I, l are not base58
    expect(isValidSolanaAddress("a".repeat(45))).toBe(false);
    expect(isValidSolanaAddress("")).toBe(false);
  });
});

describe("Helius parsing", () => {
  it("totals SOL, priced tokens and unpriced count", () => {
    const page = parseDasPage(fixture);
    expect(page.nativeLamports).toBe(2500000000);
    expect(sumTokens(page.items)).toEqual({ usd: 5.5, unpriced: 1 });
    expect(totalsFromPages([page])).toEqual({
      solLamports: 2500000000,
      solUsdCents: 25000,
      tokensUsdCents: 550,
      totalUsdCents: 25550,
      unpricedCount: 1,
      stableUsdCents: 0,
      volatileUsdCents: 25550,
      topHoldings: JSON.stringify([
        { symbol: "SOL", usdCents: 25000 },
        { symbol: "MINT", usdCents: 550 },
      ]),
    });
  });
  it("surfaces RPC errors", () => {
    expect(() => parseDasPage({ error: { message: "rate limited" } })).toThrow(/rate limited/);
    expect(() => parseDasPage({})).toThrow();
  });
  it("paginates when a page is full", async () => {
    const item = (usd: number) => ({ token_info: { balance: 1, price_info: { total_price: usd } } });
    const full = {
      result: { items: Array.from({ length: 1000 }, () => item(1)), nativeBalance: { lamports: 1, total_price: 0 } },
    };
    const last = { result: { items: [item(2)] } };
    const calls: number[] = [];
    const fake = async (_url: string, init: RequestInit) => {
      const page = (JSON.parse(String(init.body)) as { params: { page: number } }).params.page;
      calls.push(page);
      return new Response(JSON.stringify(page === 1 ? full : last), { status: 200 });
    };
    const t = await fetchWalletTotals("So11111111111111111111111111111111111111112", "https://rpc.invalid/?key=secret", fake);
    expect(calls).toEqual([1, 2]);
    expect(t.tokensUsdCents).toBe(100200);
    expect(t.solLamports).toBe(1);
  });
  it("error text never contains the rpc url", async () => {
    const fake = async () => new Response("no", { status: 500 });
    const err = await fetchWalletTotals("a".repeat(40), "https://rpc.invalid/?key=secret", fake).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/HTTP 500/);
    expect((err as Error).message).not.toMatch(/secret/);
  });
});
