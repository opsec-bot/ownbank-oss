// One-shot 90 day history backfill: ONE SimpleFIN request, same upsert/reconcile path as a normal sync, and it
// counts against the request budget. Prints counts only (no payees, descriptions, amounts or addresses).
// Optional: --savings <address prefix> / --trading <address prefix> set a wallet role first (local testing).
// Usage: npm run backfill [-- --savings Abcd --trading Wxyz]
import { eq, like, sql } from "drizzle-orm";
import { runSync } from "../src/lib/bank/sync";
import { getDb, schema } from "../src/lib/db";
import { runPendingTasks } from "../src/lib/finance/recategorize";
import { ensureSecrets } from "../src/lib/secrets";

ensureSecrets(); // fill missing secrets from secrets.json next to the database

async function main() {
  const db = getDb();
  console.log("pending tasks:", runPendingTasks(db).join(",") || "none");

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--savings" && args[i] !== "--trading") continue;
    const role = args[i] === "--trading" ? "trading" : "savings";
    const prefix = args[++i];
    if (!prefix || prefix.length < 3) throw new Error("Role prefix needs 3+ characters");
    const res = db.update(schema.cryptoWallets).set({ role }).where(like(schema.cryptoWallets.address, `${prefix}%`)).run();
    console.log(`role ${role}: ${res.changes} wallet(s)`);
  }

  const out = await runSync("manual", { backfill: true });
  if (!out.ok) {
    console.log("backfill:", "skipped" in out ? `skipped (${out.skipped})` : `failed (${out.error})`);
  } else {
    const s = out.stats;
    console.log(`backfill: ok accounts=${s.accounts} inserted=${s.inserted} updated=${s.updated} removed=${s.removed} newIncome=${s.newIncomeTxIds.length}`);
  }

  const total = db.select({ n: sql<number>`count(*)` }).from(schema.transactions).get()?.n ?? 0;
  const span = db.$client.prepare(`SELECT MIN(date) AS a, MAX(date) AS b FROM transactions`).get() as { a: string | null; b: string | null };
  const days = span.a && span.b ? Math.round((Date.parse(span.b) - Date.parse(span.a)) / 86400000) + 1 : 0;
  console.log(`transactions total=${total} spanDays=${days}`);
  const dist = db
    .select({ name: schema.categories.name, n: sql<number>`count(*)` })
    .from(schema.transactions)
    .leftJoin(schema.categories, eq(schema.transactions.categoryId, schema.categories.id))
    .groupBy(schema.categories.name)
    .all();
  console.log("categories:", dist.map((d) => `${d.name ?? "none"}=${d.n}`).join(" "));
  const rec = db.select().from(schema.recurringCharges).all();
  console.log(`recurring=${rec.length} (out=${rec.filter((r) => r.avgAmountCents < 0).length} in=${rec.filter((r) => r.avgAmountCents > 0).length})`);
  const wallets = db.select().from(schema.cryptoWallets).all();
  for (const w of wallets) {
    console.log(`wallet ${w.role}: ${w.updatedAt ? "got total" : "no total"}${w.lastError ? ` (error: ${w.lastError})` : ""} stable>0=${w.stableUsdCents > 0}`);
  }
  console.log(`wallet flows=${db.select({ n: sql<number>`count(*)` }).from(schema.walletFlows).get()?.n ?? 0}`);
  const conn = db.select().from(schema.connections).get();
  console.log(`connection status=${conn?.status} lastError=${conn?.lastError ?? "none"}`);
}

main().catch((e) => {
  console.error("backfill failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
