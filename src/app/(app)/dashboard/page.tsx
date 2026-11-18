import Link from "next/link";
import { ListGroup, ListRow } from "@/components/list";
import { card, signed } from "@/components/ui";
import { parseDigestNote } from "@/lib/finance/digest-note";
import { requireSession } from "@/lib/auth/request";
import { getDb } from "@/lib/db";
import { loadDashboard } from "@/lib/finance/dashboard";
import { displayAccountName, formatCents, timeAgo } from "@/lib/finance/networth";

export const dynamic = "force-dynamic";

function shortDate(d: string): string {
  return `${d.slice(5, 7)}/${d.slice(8, 10)}`;
}

function walletSub(w: { topHoldings: string; address: string }): string {
  try {
    const h = JSON.parse(w.topHoldings) as { symbol?: string }[];
    const syms = h.map((x) => x.symbol).filter((x): x is string => Boolean(x)).slice(0, 3);
    if (syms.length > 0) return syms.join(" · ");
  } catch {
    // fall through to the address
  }
  return w.address.length > 8 ? `${w.address.slice(0, 4)}…${w.address.slice(-4)}` : w.address;
}

export default async function DashboardPage() {
  await requireSession();
  const d = loadDashboard(getDb());
  const conn = d.connection;
  const m = d.month;
  const spendDelta = m.spendCents - m.lastMonthSamePointCents;
  const flow = m.cashIn - m.cashOut;
  const overBudgets = d.budgets.filter((b) => b.status === "over").length;
  const safeNeg = d.safe.safeCents < 0;
  const note =
    d.digest.stored && d.digest.source === "claude" ? parseDigestNote(d.digest.body) : { verdict: null, actions: [] as string[] };

  return (
    <main className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[28px] font-bold tracking-tight">Home</h1>
        {!conn ? (
          <Link href="/settings/bank" className="rounded-full border border-accent px-3 py-1 text-sm text-accent">
            Connect a bank
          </Link>
        ) : conn.status === "broken" ? (
          <Link href="/settings/bank#replace" className="rounded-full border border-danger px-3 py-1 text-sm text-danger">
            Connection broken: fix
          </Link>
        ) : (
          <span className="text-xs text-muted">Synced {timeAgo(conn.lastSyncedAt)}</span>
        )}
      </div>

      {d.forecast.warn && (
        <p role="alert" className="rounded-lg border border-danger p-3 text-sm text-danger">
          Checking is projected under {formatCents(d.safe.bufferCents)} on {shortDate(d.forecast.warnDate ?? d.today)}
          {d.forecast.nextIncomeDate ? `, before income on ${shortDate(d.forecast.nextIncomeDate)}` : ""}.
        </p>
      )}

      {/* Hero: the one number that answers "can I spend right now". */}
      <section className="flex flex-col gap-1 rounded-2xl bg-surface p-5">
        <p className="text-sm text-muted">Safe to spend</p>
        <p className={"text-5xl font-semibold tracking-tight tabular-nums " + (safeNeg ? "text-danger" : "")}>
          {formatCents(d.safe.safeCents)}
        </p>
        <p className="text-sm text-muted">
          {d.safe.billsBeforeIncome.length} {d.safe.billsBeforeIncome.length === 1 ? "bill" : "bills"}
          {d.safe.nextIncomeDate ? ` before payday ${shortDate(d.safe.nextIncomeDate)}` : " this month"}
          {` · ${formatCents(d.safe.bufferCents)} buffer kept`}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
          <div>
            <p className="text-xs text-muted">Net worth</p>
            <p className="text-lg font-semibold tabular-nums">{formatCents(d.netWorthCents)}</p>
            <p className="text-xs text-muted tabular-nums">30d {signed(d.change.change30dCents)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Checking available</p>
            <p className="text-lg font-semibold tabular-nums">{formatCents(d.checkingCents)}</p>
            <p className="text-xs text-muted tabular-nums">Bank total {formatCents(d.bankCashCents)}</p>
          </div>
        </div>
      </section>

      <Link href="/digest" className={card + " gap-1"}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Today{d.digest.source === "claude" && d.digest.stored ? " · by Claude" : ""}</h2>
          <span className="text-sm text-accent">Open &rarr;</span>
        </div>
        <p className="text-[15px] leading-snug">{note.verdict ?? "See today's numbers"}</p>
        {note.actions.length > 0 && (
          <p className="text-xs text-muted">
            {note.actions.length} {note.actions.length === 1 ? "thing" : "things"} to do today
          </p>
        )}
      </Link>

      {d.suggestion && !d.suggestion.fulfilled && d.suggestion.suggestedCents > 0 && (
        <section className="flex flex-col gap-1 rounded-2xl border border-accent bg-surface p-4">
          <p className="text-sm text-muted">Got {formatCents(d.suggestion.depositCents)}</p>
          <p className="text-lg">
            Move <span className="font-semibold text-accent">{formatCents(d.suggestion.suggestedCents)}</span> to savings
            {d.suggestion.fulfilledCents > 0 && (
              <span className="text-sm text-muted"> ({formatCents(d.suggestion.fulfilledCents)} done)</span>
            )}
          </p>
          <p className="text-xs text-muted">{d.suggestion.reason}</p>
        </section>
      )}
      {d.suggestion?.fulfilled && (
        <p className="text-sm text-muted">
          <span className="text-accent">&#10003;</span> Saved {formatCents(d.suggestion.fulfilledCents)} from the last{" "}
          {formatCents(d.suggestion.depositCents)} deposit
        </p>
      )}
      {d.weekly && (
        <p className="px-1 text-sm text-muted">
          This week: {d.weekly.count} deposits, {formatCents(d.weekly.depositCents)}. Save{" "}
          <span className="text-text">{formatCents(d.weekly.suggestedCents)}</span>
          {d.weekly.savedCents > 0 ? ` (${formatCents(d.weekly.savedCents)} done)` : ""}.
        </p>
      )}

      <ListGroup title="This month">
        <ListRow href="/spending" icon="chart" label="Spent" sub={`${signed(spendDelta)} vs last month`} value={formatCents(m.spendCents)} />
        <ListRow
          href="/digest"
          icon="calendar"
          label="Month end"
          sub={`Low ${formatCents(d.forecast.lowestCents)} on ${shortDate(d.forecast.lowestDate)}`}
          value={formatCents(d.forecast.endCents)}
          danger={d.forecast.endCents < 0}
        />
        <ListRow
          icon="coin"
          label="Income"
          sub={d.income ? `Next ~${shortDate(d.income.nextDate)}, ~${formatCents(d.income.medianDepositCents)}` : "None in 8 weeks"}
          value={d.income ? `${formatCents(d.income.weeklyCents)}/wk` : "n/a"}
        />
        <ListRow icon="flow" label="Cash flow" sub={`In ${formatCents(m.cashIn)} · Out ${formatCents(m.cashOut)}`} value={signed(flow)} danger={flow < 0} />
      </ListGroup>

      <ListGroup title="Savings">
        <ListRow
          href="/growth"
          icon="trend"
          label="Growth"
          sub="Kept per month"
          value={d.change.change30dCents !== null ? signed(d.change.change30dCents) : undefined}
        />
        <ListRow
          href="/settings/savings#goal"
          icon="target"
          label={d.goal ? d.goal.name : "Savings goal"}
          sub={d.goal ? `${formatCents(d.goal.currentCents)} of ${formatCents(d.goal.targetCents)}` : "Set one"}
          value={d.goal ? `${d.goal.pct}%` : undefined}
        />
        <ListRow
          href="/settings/budgets"
          icon="gauge"
          label="Budgets"
          sub={d.budgets.length === 0 ? "Set monthly limits" : `${d.budgets.length} budget${d.budgets.length === 1 ? "" : "s"}`}
          value={d.budgets.length === 0 ? "Not set" : overBudgets > 0 ? `${overBudgets} over` : "On track"}
          danger={overBudgets > 0}
        />
      </ListGroup>

      {(d.accounts.length > 0 || d.wallets.length > 0) && (
        <ListGroup
          title="Money"
          footer={
            d.wallets.length > 0
              ? `Crypto savings ${formatCents(d.crypto.stableCents)} stable · ${formatCents(d.crypto.volatileCents)} volatile` +
                (m.fundedCents > 0 || m.realizedCents > 0 ? ` · memecoin -${formatCents(m.fundedCents)} / +${formatCents(m.realizedCents)}` : "")
              : undefined
          }
        >
          {d.accounts.map((a) => (
            <ListRow
              key={a.id}
              icon="bank"
              label={displayAccountName(a.name)}
              sub={a.lastFour ? `...${a.lastFour}` : undefined}
              value={a.balanceLedgerCents === null ? "n/a" : formatCents(a.balanceLedgerCents)}
            />
          ))}
          {d.wallets.map((w) => {
            const trading = w.role === "trading";
            return (
              <ListRow
                key={w.id}
                href="/settings/wallets"
                icon="wallet"
                label={w.label || "Wallet"}
                sub={trading ? "Trading, not counted" : walletSub(w)}
                value={w.updatedAt ? formatCents(w.totalUsdCents) : "n/a"}
                muted={trading}
              />
            );
          })}
        </ListGroup>
      )}
    </main>
  );
}
