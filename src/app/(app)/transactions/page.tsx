import Link from "next/link";
import { Toggle } from "@/components/form";
import { field, primaryBtn, secondaryBtn, smallBtn } from "@/components/ui";
import { requireSession } from "@/lib/auth/request";
import { todayLocal } from "@/lib/bank/normalize";
import { getDb, schema } from "@/lib/db";
import { merchantName } from "@/lib/finance/merchant-name";
import { displayAccountName, formatCents } from "@/lib/finance/networth";
import { getTransaction, parseFilters, queryTransactions, type TxFilters } from "@/lib/finance/tx-query";
import { resetCategoryAction, setCategoryAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

// Builds a /transactions URL from filters plus extras (page, tx). Empty values are left out.
function href(f: TxFilters, extra: { page?: number; tx?: string } = {}): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.account) p.set("acct", f.account);
  if (f.category) p.set("cat", f.category);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.dir) p.set("dir", f.dir);
  if (f.pending) p.set("pending", "1");
  if (f.merchant) p.set("mk", f.merchant);
  if (extra.page && extra.page > 1) p.set("page", String(extra.page));
  if (extra.tx) p.set("tx", extra.tx);
  const s = p.toString();
  return s ? `/transactions?${s}` : "/transactions";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Today", "Yesterday", then "Sun, Nov 16".
function dayHeading(d: string, today: string): string {
  const ms = (x: string) => Date.UTC(Number(x.slice(0, 4)), Number(x.slice(5, 7)) - 1, Number(x.slice(8, 10)));
  const diff = Math.round((ms(today) - ms(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const dt = new Date(ms(d));
  return `${WEEKDAYS[dt.getUTCDay()]}, ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession();
  const sp = await searchParams;
  const f = parseFilters(sp);
  const page = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1;
  const txId = (Array.isArray(sp.tx) ? sp.tx[0] : sp.tx) ?? "";
  const db = getDb();
  const accounts = db.select().from(schema.accounts).orderBy(schema.accounts.name).all();
  const categories = db.select().from(schema.categories).orderBy(schema.categories.name).all();
  const { rows, total, pages } = queryTransactions(db, f, page);
  const current = Math.min(Math.max(1, page), pages);
  const selected = txId ? getTransaction(db, txId) : null;
  const filtersActive = Boolean(f.account || f.category || f.from || f.to || f.dir || f.pending || f.merchant);
  const here = href(f, { page: current });
  const today = todayLocal();
  const days: { date: string; items: typeof rows }[] = [];
  for (const t of rows) {
    const last = days[days.length - 1];
    if (last && last.date === t.date) last.items.push(t);
    else days.push({ date: t.date, items: [t] });
  }

  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold tracking-tight">Activity</h1>

      <form method="get" className="flex flex-col gap-3">
        {f.merchant && <input type="hidden" name="mk" value={f.merchant} />}
        <div className="flex gap-2">
          <input
            name="q"
            defaultValue={f.q}
            placeholder="Search"
            type="search"
            autoComplete="off"
            className={field}
            aria-label="Search transactions"
          />
          <button type="submit" className="rounded-lg border border-border bg-surface px-4 py-3 text-text active:bg-bg">
            Search
          </button>
        </div>
        <details open={filtersActive} className="rounded-2xl bg-surface">
          <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-accent active:bg-bg">Filters{filtersActive ? " (on)" : ""}<span aria-hidden>+</span></summary>
          <div className="grid grid-cols-2 gap-3 px-4 pb-4">
            <label className="flex flex-col gap-1.5 text-sm text-muted">
              Account
              <select name="acct" defaultValue={f.account} className={field}>
                <option value="">All</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {displayAccountName(a.name)}
                    {a.lastFour ? ` ...${a.lastFour}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-muted">
              Category
              <select name="cat" defaultValue={f.category} className={field}>
                <option value="">All</option>
                <option value="none">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-muted">
              From
              <input type="date" name="from" defaultValue={f.from} className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-muted">
              To
              <input type="date" name="to" defaultValue={f.to} className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-muted">
              Direction
              <select name="dir" defaultValue={f.dir} className={field}>
                <option value="">In and out</option>
                <option value="in">Money in</option>
                <option value="out">Money out</option>
              </select>
            </label>
            <label className="col-span-2 flex cursor-pointer items-center justify-between gap-3 py-1">
              <span>Pending only</span>
              <Toggle name="pending" value="1" defaultChecked={f.pending} />
            </label>
            <div className="col-span-2 flex items-center gap-4">
              <button type="submit" className={primaryBtn}>
                Apply
              </button>
              <Link href="/transactions" className="py-2 text-sm text-muted active:opacity-70">
                Clear
              </Link>
            </div>
          </div>
        </details>
      </form>

      {f.merchant && (
        <p className="text-sm">
          Merchant: <span className="font-medium">{merchantName(f.merchant)}</span>{" "}
          <Link href={href({ ...f, merchant: "" })} className="text-accent">
            clear
          </Link>
        </p>
      )}
      <p className="text-sm text-muted">
        {total} transaction{total === 1 ? "" : "s"}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-surface p-4 text-sm text-muted">Nothing matches.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {days.map((day) => (
            <section key={day.date} className="flex flex-col gap-1.5">
              <h2 className="px-1 text-sm font-semibold text-muted">{dayHeading(day.date, today)}</h2>
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl bg-surface">
                {day.items.map((t) => (
                  <li key={t.id}>
                    <Link href={href(f, { page: current, tx: t.id })} className="flex items-center justify-between gap-3 px-4 py-3 active:bg-bg">
                      <span className="min-w-0">
                        <span className="block truncate">{merchantName(t.description)}</span>
                        <span className="block truncate text-xs text-muted">
                          {t.categoryName ?? "Uncategorized"}
                          {t.categorySource === "manual" ? " (set by you)" : ""}
                          {t.status === "pending" ? " · pending" : ""}
                        </span>
                      </span>
                      <span className={"shrink-0 tabular-nums " + (t.amountCents > 0 ? "text-accent" : "")}>
                        {formatCents(t.amountCents)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav className="grid grid-cols-[1fr_auto_1fr] items-center gap-3" aria-label="Pages">
          {current > 1 ? (
            <Link href={href(f, { page: current - 1 })} className={secondaryBtn + " text-center"}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted">
            {current} / {pages}
          </span>
          {current < pages ? (
            <Link href={href(f, { page: current + 1 })} className={secondaryBtn + " text-center"}>
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      {selected && (
        <div className="fixed inset-0 z-30 flex flex-col justify-end" role="dialog" aria-label="Transaction">
          <Link href={here} aria-label="Close" className="flex-1 bg-bg/80" />
          <div className="mx-auto flex max-h-[85dvh] w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            <div className="mx-auto h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-lg font-semibold">{merchantName(selected.description)}</p>
                <p className="text-sm text-muted">
                  {selected.date} · {displayAccountName(selected.accountName)}
                  {selected.lastFour ? ` ...${selected.lastFour}` : ""}
                  {selected.status === "pending" ? " · pending" : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-start gap-3">
                <p className="text-lg font-semibold tabular-nums">{formatCents(selected.amountCents)}</p>
                <Link href={here} aria-label="Close" className="-mr-2 -mt-1 flex h-9 w-9 items-center justify-center rounded-full text-xl leading-none text-muted active:bg-bg">
                  &times;
                </Link>
              </div>
            </div>
            <p className="break-words text-xs text-muted">{selected.description}</p>

            <form action={setCategoryAction} className="flex flex-col gap-3">
              <input type="hidden" name="id" value={selected.id} />
              <input type="hidden" name="return" value={here} />
              <label className="flex flex-col gap-1 text-sm text-muted">
                Category
                <select name="categoryId" defaultValue={selected.categoryId ?? ""} className={field} required>
                  <option value="" disabled>
                    Pick one
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={primaryBtn}>
                Save category
              </button>
            </form>

            <div className="flex flex-col gap-2">
              <Link
                href={`/settings/rules?new=1&pattern=${encodeURIComponent(selected.merchantKey ?? "")}&cat=${selected.categoryId ?? ""}&dir=${selected.amountCents > 0 ? "in" : "out"}`}
                className={secondaryBtn + " w-full text-center"}
              >
                Create rule from this
              </Link>
              {selected.categorySource === "manual" && (
                <form action={resetCategoryAction}>
                  <input type="hidden" name="id" value={selected.id} />
                  <input type="hidden" name="return" value={here} />
                  <button type="submit" className={smallBtn + " w-full py-3"}>
                    Back to automatic
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
