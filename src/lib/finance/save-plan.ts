import { desc, eq, inArray } from "drizzle-orm";
import { localDate } from "@/lib/bank/normalize";
import { schema, type DB } from "@/lib/db";
import { futureEvents, lookAhead } from "./income";
import { MIN_INCOME_CENTS } from "./categorize";
import { shiftDays } from "./dates";
import { checkingCents, loadDailyDiscretionary, projectBalance } from "./forecast";
import { goalPerDepositCents } from "./goal";
import { formatCents } from "./networth";

export const FULFILL_WINDOW_DAYS = 5;
export const SUGGEST_MAX_AGE_DAYS = 7; // only brand-new deposits get a suggestion (not backfilled history)
const OWN_TRANSFER = /online banking transfer|mobile banking transfer|transfer from|transfer to/i;

type Kind = "expense" | "income" | "transfer" | null;

export function isIncomeTx(t: {
  amountCents: number;
  description: string;
  categoryKind: Kind;
  categoryName: string | null;
  recurringIncome: boolean;
}): boolean {
  if (t.amountCents < MIN_INCOME_CENTS) return false;
  if (t.categoryKind === "transfer") return false; // own accounts, Zelle, savings moves
  if (t.categoryName === "Refund") return false;
  if (OWN_TRANSFER.test(t.description)) return false;
  return t.categoryName === "Income" || t.categoryKind === "income" || t.recurringIncome;
}

export type Suggestion = { suggestedCents: number; reason: string };

// Pure: the larger of save_percent of the deposit and the per-deposit amount the savings goal needs, capped so the
// projected checking balance never drops below the buffer before the following income.
export function computeSuggestion(args: {
  depositCents: number;
  savePercent: number;
  bufferCents: number;
  lowestBeforeNextIncomeCents: number; // projected low (bills + typical spending) until the following income
  followingIncomeKnown: boolean;
  goalPerDepositCents?: number; // amount the goal date needs per deposit (0/undefined = no dated goal)
  goalName?: string;
}): Suggestion {
  const pctWant = Math.floor((args.depositCents * args.savePercent) / 100);
  const goalWant = args.goalPerDepositCents ?? 0;
  const goalDrives = goalWant > pctWant;
  const want = Math.max(pctWant, goalWant);
  if (want <= 0) return { suggestedCents: 0, reason: "Save percent is 0" };
  const headroom = args.lowestBeforeNextIncomeCents - args.bufferCents;
  if (headroom <= 0) {
    return {
      suggestedCents: 0,
      reason: `Bills before the next income leave no room above the ${formatCents(args.bufferCents)} buffer`,
    };
  }
  if (headroom < want) {
    const note = args.followingIncomeKnown ? "" : " (next income date unknown, 14 day look-ahead)";
    return { suggestedCents: headroom, reason: `Capped to keep ${formatCents(args.bufferCents)} after bills${note}` };
  }
  if (goalDrives) return { suggestedCents: want, reason: `Pace for goal${args.goalName ? ` "${args.goalName}"` : ""}` };
  return { suggestedCents: want, reason: `${args.savePercent}% of the deposit` };
}

export function suggestSave(db: DB, incomeTx: { amountCents: number }, now = Date.now()): Suggestion {
  const s = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get();
  const today = localDate(Math.floor(now / 1000));
  const { income, horizon: toDate } = lookAhead(db, today, shiftDays(today, 14));
  const events = futureEvents(db, today, toDate);
  const p = projectBalance({
    startCents: checkingCents(db.select().from(schema.accounts).all()),
    today,
    toDate,
    events: events.filter((e) => e.amountCents < 0),
    dailySpendCents: loadDailyDiscretionary(db, today),
  });
  const goal = goalPerDepositCents(db, today);
  return computeSuggestion({
    goalPerDepositCents: goal?.cents,
    goalName: goal?.goalName,
    depositCents: incomeTx.amountCents,
    savePercent: s?.savePercent ?? 20,
    bufferCents: s?.bufferCents ?? 5000,
    lowestBeforeNextIncomeCents: p.lowestCents,
    followingIncomeKnown: income !== undefined,
  });
}

// Called by the sync engine with the ids of newly inserted transactions. Returns ids that got a suggestion.
export function createSuggestionsForNew(db: DB, txIds: string[], now = Date.now()): string[] {
  if (txIds.length === 0) return [];
  const today = localDate(Math.floor(now / 1000));
  const recurringIncome = new Set(
    db
      .select()
      .from(schema.recurringCharges)
      .all()
      .filter((r) => !r.ignored && r.avgAmountCents > 0)
      .map((r) => r.merchantKey),
  );
  const rows: {
    id: string;
    amountCents: number;
    description: string;
    date: string;
    merchantKey: string | null;
    kind: Kind;
    name: string | null;
  }[] = [];
  for (let i = 0; i < txIds.length; i += 500) {
    rows.push(
      ...db
        .select({
          id: schema.transactions.id,
          amountCents: schema.transactions.amountCents,
          description: schema.transactions.description,
          date: schema.transactions.date,
          merchantKey: schema.transactions.merchantKey,
          kind: schema.categories.kind,
          name: schema.categories.name,
        })
        .from(schema.transactions)
        .leftJoin(schema.categories, eq(schema.categories.id, schema.transactions.categoryId))
        .where(inArray(schema.transactions.id, txIds.slice(i, i + 500)))
        .all(),
    );
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const out: string[] = [];
  for (const t of rows) {
    if (t.date < shiftDays(today, -SUGGEST_MAX_AGE_DAYS)) continue;
    const income = isIncomeTx({
      amountCents: t.amountCents,
      description: t.description,
      categoryKind: t.kind,
      categoryName: t.name,
      recurringIncome: t.merchantKey !== null && recurringIncome.has(t.merchantKey),
    });
    if (!income) continue;
    const sug = suggestSave(db, t, now);
    db.insert(schema.saveSuggestions)
      .values({ incomeTxId: t.id, suggestedCents: sug.suggestedCents, reason: sug.reason, createdAt: now })
      .onConflictDoNothing()
      .run();
    out.push(t.id);
  }
  return out;
}

// Marks suggestions fulfilled from "Savings transfer" outflows within 5 days after the income date.
export function updateFulfillment(db: DB, now = Date.now()): number {
  const rows = db
    .select({ s: schema.saveSuggestions, date: schema.transactions.date })
    .from(schema.saveSuggestions)
    .innerJoin(schema.transactions, eq(schema.transactions.id, schema.saveSuggestions.incomeTxId))
    .all();
  const stmt = db.$client.prepare(
    `SELECT COALESCE(SUM(-t.amount_cents), 0) AS s FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE c.name = 'Savings transfer' AND t.amount_cents < 0 AND t.date >= ? AND t.date <= ?`,
  );
  let changed = 0;
  for (const { s, date } of rows) {
    const sum = (stmt.get(date, shiftDays(date, FULFILL_WINDOW_DAYS)) as { s: number }).s;
    const done = s.suggestedCents > 0 && sum >= s.suggestedCents;
    const fulfilledAt = done ? (s.fulfilledAt ?? now) : null;
    if (sum === s.fulfilledCents && fulfilledAt === s.fulfilledAt) continue;
    db.update(schema.saveSuggestions)
      .set({ fulfilledCents: sum, fulfilledAt })
      .where(eq(schema.saveSuggestions.incomeTxId, s.incomeTxId))
      .run();
    changed++;
  }
  return changed;
}

export type LatestSuggestion = {
  incomeTxId: string;
  depositCents: number;
  incomeDate: string;
  suggestedCents: number;
  reason: string;
  fulfilledCents: number;
  fulfilled: boolean;
  unmetCents: number;
};

export function latestSuggestion(db: DB): LatestSuggestion | null {
  const r = db
    .select({ s: schema.saveSuggestions, amount: schema.transactions.amountCents, date: schema.transactions.date })
    .from(schema.saveSuggestions)
    .innerJoin(schema.transactions, eq(schema.transactions.id, schema.saveSuggestions.incomeTxId))
    .orderBy(desc(schema.transactions.date), desc(schema.saveSuggestions.createdAt))
    .limit(1)
    .get();
  if (!r) return null;
  return {
    incomeTxId: r.s.incomeTxId,
    depositCents: r.amount,
    incomeDate: r.date,
    suggestedCents: r.s.suggestedCents,
    reason: r.s.reason,
    fulfilledCents: r.s.fulfilledCents,
    fulfilled: r.s.suggestedCents > 0 && r.s.fulfilledAt !== null,
    unmetCents: Math.max(0, r.s.suggestedCents - r.s.fulfilledCents),
  };
}

export type WeeklyRollup = { count: number; depositCents: number; suggestedCents: number; savedCents: number };

// Wages that arrive in many small deposits (earned-wage payouts): when more than 2 income deposits landed in the last
// 7 days, show one weekly total next to the per-deposit suggestions. Returns null otherwise.
export function weeklyRollup(db: DB, today: string): WeeklyRollup | null {
  const from = shiftDays(today, -6);
  const dated = db.$client
    .prepare(
      `SELECT t.id, t.amount_cents AS amountCents, t.description, t.merchant_key AS merchantKey, c.kind, c.name
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.date >= ? AND t.date <= ? AND t.amount_cents > 0`,
    )
    .all(from, today) as { id: string; amountCents: number; description: string; merchantKey: string | null; kind: Kind; name: string | null }[];
  const recurringIncome = new Set(
    db
      .select()
      .from(schema.recurringCharges)
      .all()
      .filter((r) => !r.ignored && r.avgAmountCents > 0)
      .map((r) => r.merchantKey),
  );
  const income = dated.filter((t) =>
    isIncomeTx({
      amountCents: t.amountCents,
      description: t.description,
      categoryKind: t.kind,
      categoryName: t.name,
      recurringIncome: t.merchantKey !== null && recurringIncome.has(t.merchantKey),
    }),
  );
  if (income.length <= 2) return null;
  const depositCents = income.reduce((s, t) => s + t.amountCents, 0);
  const sugg = db.select().from(schema.saveSuggestions).all();
  const byId = new Map(sugg.map((s) => [s.incomeTxId, s.suggestedCents]));
  const percent = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get()?.savePercent ?? 20;
  const suggestedCents = income.some((t) => byId.has(t.id))
    ? income.reduce((s, t) => s + (byId.get(t.id) ?? 0), 0)
    : Math.floor((depositCents * percent) / 100);
  const saved = db.$client
    .prepare(
      `SELECT COALESCE(SUM(-t.amount_cents), 0) AS s FROM transactions t JOIN categories c ON c.id = t.category_id
       WHERE c.name = 'Savings transfer' AND t.amount_cents < 0 AND t.date >= ? AND t.date <= ?`,
    )
    .get(from, today) as { s: number };
  return { count: income.length, depositCents, suggestedCents, savedCents: saved.s };
}
