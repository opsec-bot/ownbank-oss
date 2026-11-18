// Dev only. Rescans trading flows from scratch for local testing (clears the cursor). Prints counts only.
import { getDb, schema } from "../src/lib/db";
import { scanTradingFlows } from "../src/lib/solana/flows";

async function main() {
  const db = getDb();
  db.update(schema.cryptoWallets).set({ lastSignature: null }).run();
  const r = await scanTradingFlows(db, process.env.HELIUS_RPC_URL ?? "", { solUsd: null, tokens: new Map() });
  console.log(`fetched=${r.fetched} stored=${r.stored}`);
}

main().catch((e) => {
  console.error("dev-flows failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
