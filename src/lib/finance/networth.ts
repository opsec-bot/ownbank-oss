// Net worth = depository balances - credit card debt + crypto (USD). All integer cents.

export type AccountBalance = { type: string | null; balanceLedgerCents: number | null; hidden?: boolean };
export type WalletBalance = {
  totalUsdCents: number;
  stableUsdCents?: number;
  volatileUsdCents?: number;
  role?: "savings" | "trading";
};

export function netWorthCents(accounts: AccountBalance[], wallets: WalletBalance[]): number {
  let total = 0;
  for (const a of accounts) {
    if (a.hidden || a.balanceLedgerCents === null) continue;
    // Card balances are debt whichever sign the bank reports them with.
    total += a.type === "credit" ? -Math.abs(a.balanceLedgerCents) : a.balanceLedgerCents;
  }
  // Trading wallets are treated as already spent until realized: not part of net worth.
  for (const w of wallets) if (w.role !== "trading") total += w.totalUsdCents;
  return total;
}

export type CryptoSplit = { stableCents: number; volatileCents: number; tradingCents: number };

// Savings wallets split into stable (USDC/USDT/PYUSD) and volatile; trading wallets reported separately.
export function cryptoSplit(wallets: WalletBalance[]): CryptoSplit {
  const out: CryptoSplit = { stableCents: 0, volatileCents: 0, tradingCents: 0 };
  for (const w of wallets) {
    if (w.role === "trading") out.tradingCents += w.totalUsdCents;
    else {
      out.stableCents += w.stableUsdCents ?? 0;
      out.volatileCents += w.volatileUsdCents ?? w.totalUsdCents - (w.stableUsdCents ?? 0);
    }
  }
  return out;
}

// "Fake Checking- 1234 (1234)" -> "Fake Checking" (the last four is shown separately).
export function displayAccountName(name: string): string {
  const cleaned = name
    .replace(/\s*\(\D*\d*\)\s*$/, "")
    .replace(/[\s-]*\d{4}\s*$/, "")
    .replace(/[\s-]+$/, "")
    .trim();
  return cleaned || name;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export function timeAgo(thenMs: number | null, nowMs = Date.now()): string {
  if (thenMs === null) return "never";
  const mins = Math.max(0, Math.floor((nowMs - thenMs) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
