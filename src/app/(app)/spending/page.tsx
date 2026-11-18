import Link from "next/link";
import { requireSession } from "@/lib/auth/request";
import { todayLocal } from "@/lib/bank/normalize";
import { getDb } from "@/lib/db";
import { loadBudgets } from "@/lib/finance/budgets";
import { addMonthsStart } from "@/lib/finance/dates";
import { merchantName } from "@/lib/finance/merchant-name";
import { formatCents } from "@/lib/finance/networth";
import { categoryBreakdown, merchantBreakdown, periods, type Comparison } from "@/lib/finance/spending";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function label(m: string): string {
  return `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}

const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function longLabel(m: string): string {
  return `${FULL_MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}
const chevBtn = "flex size-11 items-center justify-center rounded-full bg-surface text-2xl leading-none text-text active:bg-border";

function Compare({ c }: { c: Comparison }) {
  const pct = c.pctVsAvg;
  if (c.cents <= 0) return null;
  if (c.avg3Cents === null) return <p className="text-xs text-muted">Last month {formatCents(c.lastSameCents)} so far</p>;
  return (
    <p className="text-xs text-muted">
      vs 3-mo avg {formatCents(c.avg3Cents)}
      {pct !== null && (
        <span className={pct > 25 ? "text-danger" : ""}>
          {" "}
          · {pct > 0 ? "+" : ""}
          {pct}%
        </span>
      )}
    </p>
  );
}

export default async function SpendingPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession();
  const sp = await searchParams;
  const db = getDb();
  const today = todayLocal();
  const requested = first(sp.m);
  const month = /^\d{4}-\d{2}$/.test(requested) ? requested : today.slice(0, 7);
  const earliest = (db.$client.prepare("SELECT MIN(date) AS d FROM transactions").get() as { d: string | null }).d;
  const p = periods(`${month}-01`, today, earliest);
  const prev = addMonthsStart(p.from, -1).slice(0, 7);
  const next = addMonthsStart(p.from, 1).slice(0, 7);
  const hasNext = next <= today.slice(0, 7);

  const cat = first(sp.cat);
  const cats = categoryBreakdown(db, p);
  const selected = cat ? cats.find((c) => c.key === cat) : undefined;
  const maxCents = Math.max(1, ...cats.map((c) => c.cents));
  const total = cats.reduce((s, c) => s + c.cents, 0);
  // Zero-spend categories are just empty bars; leave them out of the list.
  const shown = cats.filter((c) => c.cents > 0);
  const merchants = selected && selected.key !== "trading" ? merchantBreakdown(db, p, selected.key) : [];
  const budgetByCat = new Map(month === today.slice(0, 7) ? loadBudgets(db, today).map((b) => [String(b.categoryId), b]) : []);
  const top = selected ? [] : merchantBreakdown(db, p, null, 8);

  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold tracking-tight">Spending</h1>

      <div className="flex items-center justify-between gap-3">
        <Link href={`/spending?m=${prev}`} className={chevBtn} aria-label="Previous month">
          &lsaquo;
        </Link>
        <p className="text-center font-medium">{longLabel(month)}</p>
        {hasNext ? (
          <Link href={`/spending?m=${next}`} className={chevBtn} aria-label="Next month">
            &rsaquo;
          </Link>
        ) : (
          <span className={chevBtn + " opacity-30"} aria-hidden>
            &rsaquo;
          </span>
        )}
      </div>

      {selected ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <Link href={`/spending?m=${month}`} className="text-accent">
              &larr; All categories
            </Link>
            <p className="font-semibold">{selected.name}</p>
          </div>
          <section className="flex flex-col gap-1 rounded-2xl bg-surface p-5">
            <p className="text-sm text-muted">{label(month)}</p>
            <p className="text-5xl font-semibold tracking-tight tabular-nums">{formatCents(selected.cents)}</p>
            <Compare c={selected} />
          </section>
          {selected.key === "trading" ? (
            <p className="text-sm text-muted">Money moved from savings wallets to the trading wallet.</p>
          ) : merchants.length === 0 ? (
            <p className="text-sm text-muted">No merchants this month.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-2xl bg-surface">
              {merchants.map((m) => (
                <li key={m.merchantKey}>
                  <Link
                    href={`/transactions?mk=${encodeURIComponent(m.merchantKey)}&from=${p.from}&to=${p.point}&dir=out${/^\d+$/.test(selected.key) ? `&cat=${selected.key}` : ""}`}
                    className="flex flex-col gap-1 px-4 py-3 active:bg-bg"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate">{merchantName(m.merchantKey)}</span>
                      <span className="shrink-0 tabular-nums">{formatCents(m.cents)}</span>
                    </span>
                    <span className="text-xs text-muted">
                      {m.count} purchase{m.count === 1 ? "" : "s"} · avg {formatCents(m.avgTicketCents)}
                    </span>
                    <Compare c={m} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <section className="flex flex-col gap-1 rounded-2xl bg-surface p-5">
            <p className="text-sm text-muted">Spent in {label(month)}</p>
            <p className="text-5xl font-semibold tracking-tight tabular-nums">{formatCents(total)}</p>
          </section>

          {shown.length === 0 ? (
            <p className="rounded-2xl bg-surface p-4 text-sm text-muted">No spending this month.</p>
          ) : (
            <section className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <h2 className="px-1 text-sm font-semibold">Categories</h2>
                <Link href="/settings/budgets" className="text-sm text-accent">
                  Edit budgets
                </Link>
              </div>
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl bg-surface">
                {shown.map((c) => {
                  const bud = budgetByCat.get(c.key);
                  const over = bud ? c.cents > bud.limitCents : false;
                  const pct = bud ? Math.min(100, Math.round((c.cents / bud.limitCents) * 100)) : Math.round((c.cents / maxCents) * 100);
                  return (
                    <li key={c.key}>
                      <Link href={`/spending?m=${month}&cat=${c.key}`} className="flex flex-col gap-2 px-4 py-3 active:bg-bg">
                        <span className="flex items-baseline justify-between gap-3">
                          <span>{c.name}</span>
                          <span className="tabular-nums">{formatCents(c.cents)}</span>
                        </span>
                        <span className="h-2 rounded-full bg-bg">
                          <span
                            className={"block h-2 rounded-full " + (over ? "bg-danger" : "bg-accent")}
                            style={{ width: `${Math.max(c.cents > 0 ? 2 : 0, pct)}%` }}
                          />
                        </span>
                        {bud ? (
                          <span className={"text-xs tabular-nums " + (over ? "text-danger" : "text-muted")}>
                            {over ? `${wholeMoney(c.cents - bud.limitCents)} over` : `${wholeMoney(bud.limitCents - c.cents)} left`} of {wholeMoney(bud.limitCents)} budget
                          </span>
                        ) : (
                          <Compare c={c} />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {top.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="px-1 text-sm font-medium">Top merchants</h2>
              <ul className="flex flex-col divide-y divide-border rounded-2xl bg-surface">
                {top.map((m) => (
                  <li key={m.merchantKey}>
                    <Link
                      href={`/transactions?mk=${encodeURIComponent(m.merchantKey)}&from=${p.from}&to=${p.point}&dir=out`}
                      className="flex items-center justify-between gap-3 px-4 py-3 active:bg-bg"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{merchantName(m.merchantKey)}</span>
                        <span className="block text-xs text-muted">
                          {m.count} purchase{m.count === 1 ? "" : "s"} · avg {formatCents(m.avgTicketCents)}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatCents(m.cents)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function wholeMoney(cents: number): string {
  return `$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
}
