// Dev only. Runs ONE sync against the local database and prints counts only (no payees, descriptions or balances).
// Optional: --wallet <address> adds a Solana wallet first (public address) so the balance refresh has something to do.
// Uses the real SimpleFIN quota (one request). Usage: npm run dev:sync -- [--wallet <addr> ...]
import { eq, sql } from "drizzle-orm";
import { runSync } from "../src/lib/bank/sync";
import { getDb, schema } from "../src/lib/db";
import { isValidSolanaAddress } from "../src/lib/solana/balances";
import { ensureSecrets } from "../src/lib/secrets";

ensureSecrets(); // fill missing secrets from secrets.json next to the database

async function main() {
  const db = getDb();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--wallet") continue;
    const address = args[++i];
    if (!address || !isValidSolanaAddress(address)) throw new Error("Invalid --wallet address");
    db.insert(schema.cryptoWallets).values({ address, label: "" }).onConflictDoNothing().run();
  }

  const out = await runSync("manual");
  if (!out.ok) {
    console.log("sync:", "skipped" in out ? `skipped (${out.skipped})` : `failed (${out.error})`);
  } else {
    const s = out.stats;
    console.log(`sync: ok accounts=${s.accounts} inserted=${s.inserted} updated=${s.updated} removed=${s.removed} newLarge=${s.newLargeTxIds.length}`);
  }

  const total = db.select({ n: sql<number>`count(*)` }).from(schema.transactions).get()?.n ?? 0;
  const dist = db
    .select({ name: schema.categories.name, n: sql<number>`count(*)` })
    .from(schema.transactions)
    .leftJoin(schema.categories, eq(schema.transactions.categoryId, schema.categories.id))
    .groupBy(schema.categories.name)
    .all();
  console.log(`transactions total=${total}`);
  console.log("categories:", dist.map((d) => `${d.name ?? "none"}=${d.n}`).join(" "));
  const bySource = db
    .select({ s: schema.transactions.categorySource, n: sql<number>`count(*)` })
    .from(schema.transactions)
    .groupBy(schema.transactions.categorySource)
    .all();
  console.log("sources:", bySource.map((d) => `${d.s}=${d.n}`).join(" "));
  const recurring = db.select({ n: sql<number>`count(*)` }).from(schema.recurringCharges).get()?.n ?? 0;
  console.log(`recurring=${recurring}`);
  const wallets = db.select().from(schema.cryptoWallets).all();
  for (const w of wallets) {
    console.log(`wallet ${w.address.slice(0, 4)}...: ${w.updatedAt ? "got total" : "no total"}${w.lastError ? ` (error: ${w.lastError})` : ""} unpriced=${w.unpricedCount}`);
  }
  const conn = db.select().from(schema.connections).get();
  console.log(`connection status=${conn?.status} lastError=${conn?.lastError ?? "none"}`);
}

main().catch((e) => {
  console.error("dev-sync failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
