import { desc, eq } from "drizzle-orm";
import { localDate } from "@/lib/bank/normalize";
import { schema, type DB } from "@/lib/db";
import { safeToSpend, type SafeToSpend } from "./afford";
import { buildDigestData, renderAutoDigest } from "./digest";
import { loadBudgets, type BudgetRow } from "./budgets";
import { bankCashCents, checkingCents, loadForecast, type Projection } from "./forecast";
import { loadGoalProgress, type GoalProgress } from "./goal";
import { cryptoSplit, type CryptoSplit } from "./networth";
import { loadIncomeRate, type IncomeRate } from "./income";
import { latestSuggestion, weeklyRollup, type LatestSuggestion, type WeeklyRollup } from "./save-plan";
import { computeSnapshot, netWorthChange, type NetWorthChange } from "./snapshots";
import { monthView, type MonthView } from "./stats";

export type DigestView = { day: string; source: "claude" | "auto"; body: string; stored: boolean };

// Today's digest: the stored one (Claude or auto) when it exists, else a numbers-only one built on the fly.
export function digestForToday(db: DB, now = Date.now()): DigestView {
  const day = localDate(Math.floor(now / 1000));
  const row = db.select().from(schema.digests).where(eq(schema.digests.day, day)).get();
  if (row) return { day, source: row.source, body: row.bodyMd, stored: true };
  return { day, source: "auto", body: renderAutoDigest(buildDigestData(db, now)), stored: false };
}

export function latestStoredDigest(db: DB) {
  return db.select().from(schema.digests).orderBy(desc(schema.digests.day)).limit(1).get() ?? null;
}

export type Dashboard = {
  today: string;
  connection: typeof schema.connections.$inferSelect | undefined;
  accounts: (typeof schema.accounts.$inferSelect)[];
  wallets: (typeof schema.cryptoWallets.$inferSelect)[];
  netWorthCents: number;
  change: NetWorthChange;
  bankCashCents: number;
  checkingCents: number;
  crypto: CryptoSplit;
  month: MonthView;
  forecast: Projection & { startCents: number };
  safe: SafeToSpend;
  suggestion: LatestSuggestion | null;
  weekly: WeeklyRollup | null;
  income: IncomeRate | null;
  digest: DigestView;
  budgets: BudgetRow[];
  goal: GoalProgress | null;
};

export function loadDashboard(db: DB, now = Date.now()): Dashboard {
  const today = localDate(Math.floor(now / 1000));
  const accounts = db.select().from(schema.accounts).orderBy(schema.accounts.name).all().filter((a) => !a.hidden);
  const wallets = db.select().from(schema.cryptoWallets).orderBy(schema.cryptoWallets.id).all();
  const snap = computeSnapshot(accounts, wallets);
  const buffer = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get()?.bufferCents ?? 5000;
  return {
    today,
    connection: db.select().from(schema.connections).orderBy(schema.connections.id).limit(1).get(),
    accounts,
    wallets,
    netWorthCents: snap.totalCents,
    change: netWorthChange(db, today, snap.totalCents),
    bankCashCents: bankCashCents(accounts),
    checkingCents: checkingCents(accounts),
    crypto: cryptoSplit(wallets),
    month: monthView(db, today),
    forecast: loadForecast(db, today, buffer),
    safe: safeToSpend(db, now),
    suggestion: latestSuggestion(db),
    weekly: weeklyRollup(db, today),
    income: loadIncomeRate(db, today),
    digest: digestForToday(db, now),
    budgets: loadBudgets(db, today),
    goal: loadGoalProgress(db, today),
  };
}

// Digest screen data: numbers plus today's stored digest, built from one clock reading.
export function loadDigestPage(db: DB, now = Date.now()) {
  return { data: buildDigestData(db, now), today: digestForToday(db, now) };
}
