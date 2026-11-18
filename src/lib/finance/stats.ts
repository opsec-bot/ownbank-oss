import { schema, type DB } from "@/lib/db";
import { addMonthsStart, monthStart, sameDayInMonth } from "./dates";

// Date-range aggregates for the dashboard and digest. Dates are inclusive YYYY-MM-DD. All cents.
// "Spend" = expense-kind (or uncategorized) transactions net of refunds, plus on-chain funding of trading wallets.
// Transfer and income categories are excluded.

export type CategorySpend = { name: string; cents: number };

const EXPENSE_FILTER = `COALESCE(c.kind, 'expense') = 'expense'`;

export function tradingFlows(db: DB, from: string, to: string): { fundedCents: number; realizedCents: number } {
  const rows = db.$client
    .prepare(`SELECT kind, COALESCE(SUM(usd_cents), 0) AS s FROM wallet_flows WHERE day >= ? AND day <= ? GROUP BY kind`)
    .all(from, to) as { kind: string; s: number }[];
  return {
    fundedCents: rows.find((r) => r.kind === "trading_funded")?.s ?? 0,
    realizedCents: rows.find((r) => r.kind === "trading_realized")?.s ?? 0,
  };
}

export function spendBetween(db: DB, from: string, to: string): number {
  const r = db.$client
    .prepare(
      `SELECT COALESCE(SUM(-t.amount_cents), 0) AS s FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.date >= ? AND t.date <= ? AND ${EXPENSE_FILTER}`,
    )
    .get(from, to) as { s: number };
  return r.s + tradingFlows(db, from, to).fundedCents;
}

export function categorySpend(db: DB, from: string, to: string): CategorySpend[] {
  const rows = db.$client
    .prepare(
      `SELECT COALESCE(c.name, 'Uncategorized') AS name, SUM(-t.amount_cents) AS cents FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.date >= ? AND t.date <= ? AND ${EXPENSE_FILTER}
       GROUP BY name HAVING cents > 0`,
    )
    .all(from, to) as CategorySpend[];
  const funded = tradingFlows(db, from, to).fundedCents;
  if (funded > 0) rows.push({ name: "Memecoin trading", cents: funded });
  return rows.sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
}

export function cashFlow(db: DB, from: string, to: string): { inCents: number; outCents: number } {
  const r = db.$client
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents END), 0) AS i,
              COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents END), 0) AS o
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.date >= ? AND t.date <= ? AND COALESCE(c.kind, 'expense') != 'transfer'`,
    )
    .get(from, to) as { i: number; o: number };
  return { inCents: r.i, outCents: r.o };
}

export function savingsTransfers(db: DB, from: string, to: string): { count: number; cents: number } {
  const r = db.$client
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(-t.amount_cents), 0) AS s FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE c.name = 'Savings transfer' AND t.amount_cents < 0 AND t.date >= ? AND t.date <= ?`,
    )
    .get(from, to) as { n: number; s: number };
  return { count: r.n, cents: r.s };
}

export type MonthView = {
  spendCents: number;
  lastMonthSamePointCents: number;
  categories: CategorySpend[];
  cashIn: number;
  cashOut: number;
  fundedCents: number;
  realizedCents: number;
  savingsTransferCents: number;
};

export function monthView(db: DB, today: string): MonthView {
  const start = monthStart(today);
  const lastStart = addMonthsStart(today, -1);
  const lastSame = sameDayInMonth(today, -1);
  const flow = cashFlow(db, start, today);
  const t = tradingFlows(db, start, today);
  return {
    spendCents: spendBetween(db, start, today),
    lastMonthSamePointCents: spendBetween(db, lastStart, lastSame),
    categories: categorySpend(db, start, today),
    cashIn: flow.inCents,
    cashOut: flow.outCents,
    fundedCents: t.fundedCents,
    realizedCents: t.realizedCents,
    savingsTransferCents: savingsTransfers(db, start, today).cents,
  };
}

export function earliestTxDate(db: DB): string | null {
  return (db.$client.prepare(`SELECT MIN(date) AS d FROM transactions`).get() as { d: string | null }).d;
}

export function loadAssets(db: DB) {
  const accounts = db.select().from(schema.accounts).all().filter((a) => !a.hidden);
  const wallets = db.select().from(schema.cryptoWallets).orderBy(schema.cryptoWallets.id).all();
  return { accounts, wallets };
}
