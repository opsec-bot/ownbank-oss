import { desc, lt, lte } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { localDate } from "@/lib/bank/normalize";
import { shiftDays } from "./dates";
import { cryptoSplit, netWorthCents } from "./networth";

export type SnapshotValues = {
  bankCents: number;
  cryptoStableCents: number;
  cryptoVolatileCents: number;
  cryptoTradingCents: number;
  totalCents: number;
};

export function computeSnapshot(
  accounts: Parameters<typeof netWorthCents>[0],
  wallets: Parameters<typeof cryptoSplit>[0],
): SnapshotValues {
  const split = cryptoSplit(wallets);
  const bankCents = netWorthCents(accounts, []);
  return {
    bankCents,
    cryptoStableCents: split.stableCents,
    cryptoVolatileCents: split.volatileCents,
    cryptoTradingCents: split.tradingCents,
    totalCents: bankCents + split.stableCents + split.volatileCents,
  };
}

// Upserts today's row. Skips when there is nothing to record yet (no accounts and no wallets).
export function writeSnapshot(db: DB, now = Date.now()): string | null {
  const accounts = db.select().from(schema.accounts).all().filter((a) => !a.hidden);
  const wallets = db.select().from(schema.cryptoWallets).all();
  if (accounts.length === 0 && wallets.length === 0) return null;
  const day = localDate(Math.floor(now / 1000));
  const v = computeSnapshot(accounts, wallets);
  db.insert(schema.netWorthSnapshots)
    .values({ day, ...v })
    .onConflictDoUpdate({ target: schema.netWorthSnapshots.day, set: v })
    .run();
  return day;
}

// Latest snapshot strictly before `day` (for "vs yesterday") or on/before it (for "vs 30 days ago").
export function snapshotBefore(db: DB, day: string) {
  return db
    .select()
    .from(schema.netWorthSnapshots)
    .where(lt(schema.netWorthSnapshots.day, day))
    .orderBy(desc(schema.netWorthSnapshots.day))
    .limit(1)
    .get();
}

export function snapshotOnOrBefore(db: DB, day: string) {
  return db
    .select()
    .from(schema.netWorthSnapshots)
    .where(lte(schema.netWorthSnapshots.day, day))
    .orderBy(desc(schema.netWorthSnapshots.day))
    .limit(1)
    .get();
}

export type NetWorthChange = { change1dCents: number | null; change30dCents: number | null };

export function netWorthChange(db: DB, today: string, currentTotalCents: number): NetWorthChange {
  const y = snapshotBefore(db, today);
  const m = snapshotOnOrBefore(db, shiftDays(today, -30));
  return {
    change1dCents: y ? currentTotalCents - y.totalCents : null,
    change30dCents: m ? currentTotalCents - m.totalCents : null,
  };
}

