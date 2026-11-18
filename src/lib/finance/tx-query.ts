import type { DB } from "@/lib/db";

export const PAGE_SIZE = 50;

export type TxFilters = {
  q: string;
  account: string; // account id or ""
  category: string; // category id, "none" for uncategorized, or ""
  from: string; // YYYY-MM-DD or ""
  to: string;
  dir: "" | "in" | "out";
  pending: boolean;
  merchant: string; // exact merchant_key or ""
};

export type TxRow = {
  id: string;
  date: string;
  amountCents: number;
  description: string;
  counterparty: string | null;
  merchantKey: string | null;
  status: "pending" | "posted";
  categoryId: number | null;
  categoryName: string | null;
  categorySource: string | null;
  accountName: string;
  lastFour: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Params = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

// Reads untrusted query params into safe filter values.
export function parseFilters(sp: Params): TxFilters {
  const dir = one(sp.dir);
  const category = one(sp.cat);
  return {
    q: one(sp.q).slice(0, 100),
    account: one(sp.acct).slice(0, 100),
    category: category === "none" || /^\d{1,9}$/.test(category) ? category : "",
    from: DATE.test(one(sp.from)) ? one(sp.from) : "",
    to: DATE.test(one(sp.to)) ? one(sp.to) : "",
    dir: dir === "in" || dir === "out" ? dir : "",
    pending: one(sp.pending) === "1",
    merchant: one(sp.mk).slice(0, 100),
  };
}

// Search text -> FTS5 prefix query. Only letters and digits survive, so no FTS syntax can be injected.
export function ftsQuery(q: string): string | null {
  const tokens = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" ");
}

export function queryTransactions(db: DB, f: TxFilters, page: number, pageSize = PAGE_SIZE): { rows: TxRow[]; total: number; pages: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const fts = ftsQuery(f.q);
  if (f.q.trim() && !fts) where.push("0"); // a search with no usable text matches nothing
  if (fts) {
    where.push("t.rowid IN (SELECT rowid FROM transactions_fts WHERE transactions_fts MATCH ?)");
    params.push(fts);
  }
  if (f.account) {
    where.push("t.account_id = ?");
    params.push(f.account);
  }
  if (f.category === "none") where.push("t.category_id IS NULL");
  else if (f.category) {
    where.push("t.category_id = ?");
    params.push(Number(f.category));
  }
  if (f.from) {
    where.push("t.date >= ?");
    params.push(f.from);
  }
  if (f.to) {
    where.push("t.date <= ?");
    params.push(f.to);
  }
  if (f.dir === "in") where.push("t.amount_cents > 0");
  if (f.dir === "out") where.push("t.amount_cents < 0");
  if (f.pending) where.push("t.status = 'pending'");
  if (f.merchant) {
    where.push("t.merchant_key = ?");
    params.push(f.merchant);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = (db.$client.prepare(`SELECT COUNT(*) AS n FROM transactions t ${clause}`).get(...params) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const rows = db.$client
    .prepare(
      `SELECT t.id, t.date, t.amount_cents AS amountCents, t.description, t.counterparty, t.merchant_key AS merchantKey,
              t.status, t.category_id AS categoryId, c.name AS categoryName, t.category_source AS categorySource,
              a.name AS accountName, a.last_four AS lastFour
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       ${clause}
       ORDER BY t.date DESC, t.first_seen_at DESC, t.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (p - 1) * pageSize) as TxRow[];
  return { rows, total, pages };
}

export function getTransaction(db: DB, id: string): TxRow | null {
  const row = db.$client
    .prepare(
      `SELECT t.id, t.date, t.amount_cents AS amountCents, t.description, t.counterparty, t.merchant_key AS merchantKey,
              t.status, t.category_id AS categoryId, c.name AS categoryName, t.category_source AS categorySource,
              a.name AS accountName, a.last_four AS lastFour
       FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.id = ?`,
    )
    .get(id) as TxRow | undefined;
  return row ?? null;
}
