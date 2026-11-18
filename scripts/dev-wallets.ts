// Dev only. Refreshes wallet balances and scans trading flows once (Helius only, no SimpleFIN request).
// Prints counts only. Usage: node --conditions=react-server --env-file=.env.local --import tsx scripts/dev-wallets.ts
import { sql } from "drizzle-orm";
import { getDb, schema } from "../src/lib/db";
import { refreshAllWallets } from "../src/lib/solana/balances";

async function main() {
  const db = getDb();
  await refreshAllWallets(db);
  for (const w of db.select().from(schema.cryptoWallets).all()) {
    console.log(`wallet ${w.role}: updated=${w.updatedAt !== null} error=${w.lastError ?? "none"} stable>0=${w.stableUsdCents > 0} volatile>0=${w.volatileUsdCents > 0} holdings=${(JSON.parse(w.topHoldings) as unknown[]).length} cursor=${w.lastSignature ? "set" : "none"}`);
  }
  const flows = db.select({ kind: schema.walletFlows.kind, n: sql<number>`count(*)` }).from(schema.walletFlows).groupBy(schema.walletFlows.kind).all();
  console.log("flows:", flows.map((f) => `${f.kind}=${f.n}`).join(" ") || "none");
}

main().catch((e) => {
  console.error("dev-wallets failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
