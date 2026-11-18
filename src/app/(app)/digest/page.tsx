import Link from "next/link";
import { card, signed } from "@/components/ui";
import { requireSession } from "@/lib/auth/request";
import { getDb } from "@/lib/db";
import { loadDigestPage } from "@/lib/finance/dashboard";
import { autoVerdict, parseDigestNote } from "@/lib/finance/digest-note";
import { merchantName } from "@/lib/finance/merchant-name";
import { formatCents } from "@/lib/finance/networth";

export const dynamic = "force-dynamic";

function shortDate(d: string): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

function Metric({ value, label, sub, danger }: { value: string; label: string; sub?: string; danger?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-2xl bg-surface p-3">
      <p className={"truncate text-lg font-semibold tabular-nums " + (danger ? "text-danger" : "")}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
      {sub ? <p className="truncate text-xs text-muted tabular-nums">{sub}</p> : null}
    </div>
  );
}

export default async function DigestPage() {
  await requireSession();
  const db = getDb();
  const { data: d, today } = loadDigestPage(db);
  const fromClaude = today.stored && today.source === "claude";
  const note = fromClaude ? parseDigestNote(today.body) : { verdict: null, actions: [] };
  const verdict = note.verdict ?? autoVerdict(d);
  const safe = d.safeToSpend.safeCents;
  const spendDelta = d.month.spendCents - d.month.lastMonthSamePointCents;
  const over = d.categories.filter((c) => c.flagged && c.avg3mCents !== null).slice(0, 4);
  const bills = d.billsDue;

  return (
    <main className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-[28px] font-bold tracking-tight">Today</h1>
        <p className="pb-1.5 text-xs text-muted">
          {shortDate(d.date)} · {fromClaude ? "by Claude" : "auto"}
        </p>
      </div>

      <section className={card + " gap-1 p-5"}>
        <p className="text-xl font-semibold leading-snug">{verdict}</p>
        <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">
          <span className={safe < 0 ? "text-danger" : ""}>{formatCents(safe)}</span>
        </p>
        <p className="text-sm text-muted">
          safe to spend
          {d.forecast.nextIncomeDate ? ` · pay ~${shortDate(d.forecast.nextIncomeDate)}` : ""}
        </p>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <Metric value={formatCents(d.month.spendCents)} label="spent" sub={`${signed(spendDelta)} vs last`} />
        <Metric
          value={formatCents(d.forecast.projectedEndCents)}
          label="month end"
          sub={`low ${shortDate(d.forecast.lowestDate)}`}
          danger={d.forecast.projectedEndCents < 0}
        />
        <Metric
          value={formatCents(d.balances.checkingCents)}
          label="checking"
          sub={`buffer ${formatCents(d.safeToSpend.bufferCents)}`}
          danger={d.balances.checkingCents < d.safeToSpend.bufferCents}
        />
      </div>

      {note.actions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold">Do today</h2>
          <ul className="flex flex-col divide-y divide-border rounded-2xl bg-surface">
            {note.actions.map((a, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-3">
                <span aria-hidden="true" className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-accent" />
                <span className="text-[15px] leading-snug">{a}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {over.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-sm font-semibold">Over usual</h2>
            <Link href="/spending" className="text-sm text-accent">
              Spending &rarr;
            </Link>
          </div>
          <ul className="flex flex-col divide-y divide-border rounded-2xl bg-surface">
            {over.map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate">{c.name}</span>
                  <span className="block text-xs text-muted tabular-nums">usually {formatCents(c.avg3mCents ?? 0)}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{formatCents(c.mtdCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-sm font-semibold">Bills next 7 days</h2>
          <Link href="/bills" className="text-sm text-accent">
            Bills &rarr;
          </Link>
        </div>
        {bills.length === 0 ? (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-muted">None due</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-2xl bg-surface">
            {bills.map((b) => (
              <li key={b.name + b.date} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate">{merchantName(b.name)}</span>
                  <span className="block text-xs text-muted">{shortDate(b.date)}</span>
                </span>
                <span className="shrink-0 tabular-nums">{formatCents(b.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.goal && (
        <Link href="/settings/savings#goal" className={card + " gap-2"}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">{d.goal.name}</span>
            <span className="text-sm text-muted tabular-nums">{d.goal.pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-bg">
            <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(2, d.goal.pct))}%` }} />
          </div>
          <p className="text-xs text-muted tabular-nums">
            {formatCents(d.goal.currentCents)} of {formatCents(d.goal.targetCents)}
            {d.saveSuggestion && !d.saveSuggestion.fulfilled && d.saveSuggestion.suggestedCents > 0
              ? ` · save ${formatCents(d.saveSuggestion.suggestedCents)} from last deposit`
              : ""}
          </p>
        </Link>
      )}
    </main>
  );
}
