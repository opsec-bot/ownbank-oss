import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { openDb, schema, type DB } from "@/lib/db";
import { merchantKey } from "@/lib/bank/normalize";
import { categorize, type RuleRow } from "@/lib/finance/categorize";

export function freshDb(): DB {
  const db = openDb(":memory:");
  db.insert(schema.connections)
    .values({
      providerConnectionId: "test",
      institutionName: "Fake Test Bank",
      accessTokenEnc: encrypt("https://u:p@bridge.invalid/x"),
      createdAt: 0,
    })
    .run();
  return db;
}

export function catId(db: DB, name: string): number {
  return db.select().from(schema.categories).where(eq(schema.categories.name, name)).get()!.id;
}

export function addAccount(
  db: DB,
  id: string,
  opts: { name?: string; type?: string; available?: number | null; ledger?: number | null } = {},
) {
  db.insert(schema.accounts)
    .values({
      id,
      connectionId: 1,
      name: opts.name ?? "Fake Checking",
      type: opts.type ?? "depository",
      balanceAvailableCents: opts.available ?? null,
      balanceLedgerCents: opts.ledger ?? opts.available ?? null,
    })
    .run();
}

let seq = 0;
// Inserts a transaction. Category by name; omit it to run the default categorization.
export function addTx(
  db: DB,
  t: {
    date: string;
    amount: number;
    description?: string;
    payee?: string | null;
    category?: string | null;
    account?: string;
    source?: "provider" | "rule" | "manual";
    status?: "pending" | "posted";
  },
): string {
  const id = `T${++seq}`;
  const description = t.description ?? `FAKE MERCHANT ${seq}`;
  const payee = t.payee === undefined ? null : t.payee;
  let categoryId: number | null = null;
  let source: "provider" | "rule" | "manual" | null = t.source ?? null;
  if (t.category) {
    categoryId = catId(db, t.category);
    source ??= "provider";
  } else if (t.category === undefined) {
    const cats = db.select().from(schema.categories).all();
    const rules: RuleRow[] = db.select().from(schema.rules).all();
    const c = categorize(
      { description, counterparty: payee, amountCents: t.amount, mcc: null },
      rules,
      new Map(cats.map((x) => [x.name, x.id])),
    );
    categoryId = c.categoryId;
    source = c.source;
  }
  db.insert(schema.transactions)
    .values({
      id,
      accountId: t.account ?? "A1",
      date: t.date,
      amountCents: t.amount,
      description,
      counterparty: payee,
      merchantKey: merchantKey(payee, description),
      categoryId,
      categorySource: source,
      status: t.status ?? "posted",
      firstSeenAt: 0,
      updatedAt: 0,
    })
    .run();
  return id;
}
