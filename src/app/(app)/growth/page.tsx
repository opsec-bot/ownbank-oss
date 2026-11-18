import Link from "next/link";
import { BackHeader } from "@/components/list";
import { card, signed } from "@/components/ui";
import { requireSession } from "@/lib/auth/request";
import { todayLocal } from "@/lib/bank/normalize";
import { getDb } from "@/lib/db";
import { loadGrowth, monthLabel, type GrowthPoint, type MonthKept } from "@/lib/finance/growth";
import { formatCents } from "@/lib/finance/networth";

export const dynamic = "force-dynamic";

function shortDate(d: string): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

function compact(cents: number): string {
  const d = Math.abs(cents) / 100;
  const s = d >= 1000 ? `$${(d / 1000).toFixed(1)}k` : `$${Math.round(d)}`;
  return cents < 0 ? `-${s}` : s;
}

// Progress ring. Solid stroke, no gradient.
function Ring({ pct }: { pct: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <svg viewBox="0 0 120 120" className="size-32 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-bg)" strokeWidth="12" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${(p / 100) * c} ${c}`}
      />
    </svg>
  );
}

// Monthly "kept" bars around a zero line: teal above (kept money), red below (spent more than came in).
function KeptBars({ months }: { months: MonthKept[] }) {
  const max = Math.max(1, ...months.map((m) => Math.abs(m.keptCents)));
  const hasNeg = months.some((m) => m.keptCents < 0);
  const hasPos = months.some((m) => m.keptCents > 0);
  const up = hasPos ? (hasNeg ? 60 : 100) : 0;
  const H = 120;
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
      {months.map((m) => {
        const h = (Math.abs(m.keptCents) / max) * (m.keptCents >= 0 ? up : 100 - up) * (H / 100);
        return (
          <div key={m.month} className="flex flex-col items-center gap-1">
            <span className={"text-xs font-semibold tabular-nums " + (m.keptCents < 0 ? "text-danger" : "text-accent")}>
              {m.keptCents >= 0 ? "+" : ""}
              {compact(m.keptCents)}
            </span>
            <div className="relative w-full" style={{ height: H }}>
              <div className="absolute inset-x-0 border-t border-border" style={{ top: (up / 100) * H }} />
              <div
                className={"absolute inset-x-[18%] rounded-md " + (m.keptCents < 0 ? "bg-danger" : "bg-accent") + (m.partial ? " opacity-50" : "")}
                style={m.keptCents >= 0 ? { bottom: H - (up / 100) * H, height: Math.max(2, h) } : { top: (up / 100) * H, height: Math.max(2, h) }}
              />
            </div>
            <span className="text-xs text-muted">
              {monthLabel(m.month)}
              {m.partial ? "*" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function NetWorthLine({ points }: { points: GrowthPoint[] }) {
  const W = 300;
  const H = 90;
  const vals = points.map((p) => p.totalCents);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const xy = points.map((p, i) => [(i / (points.length - 1)) * W, H - 6 - ((p.totalCents - min) / span) * (H - 12)] as const);
  const last = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full overflow-visible" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={xy.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="4" fill="var(--color-accent)" />
    </svg>
  );
}

export default async function GrowthPage() {
  await requireSession();
  const g = loadGrowth(getDb(), todayLocal());
  const full = g.months.filter((m) => !m.partial);
  // Headline uses full months only: a half month of data (first month, or this one) is not a fair score.
  const scored = full.length > 0 ? full : g.months;
  const totalKept = scored.reduce((s, m) => s + m.keptCents, 0);
  const range = scored.length > 1 ? `${monthLabel(scored[0].month)} to ${monthLabel(scored[scored.length - 1].month)}` : scored[0] ? monthLabel(scored[0].month) : "";

  return (
    <main className="flex flex-col gap-5">
      <BackHeader title="Growth" back={{ href: "/dashboard", label: "Home" }} />

      {g.goal ? (
        <Link href="/settings/savings#goal" className={card + " flex-row items-center gap-5 p-5"}>
          <div className="relative">
            <Ring pct={g.goal.pct} />
            <span className="absolute inset-0 flex items-center justify-center text-2xl font-semibold tabular-nums">{g.goal.pct}%</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted">{g.goal.name}</p>
            <p className="text-2xl font-semibold tabular-nums">{formatCents(g.goal.currentCents)}</p>
            <p className="text-sm text-muted tabular-nums">of {formatCents(g.goal.targetCents)}</p>
            <p className="mt-1 text-sm tabular-nums">{g.goal.reached ? "Reached" : `${formatCents(g.goal.toGoCents)} to go`}</p>
          </div>
        </Link>
      ) : (
        <Link href="/settings/savings#goal" className={card + " p-5"}>
          <p className="text-lg font-semibold">Set a savings goal</p>
          <p className="text-sm text-accent">Pick a target &rarr;</p>
        </Link>
      )}

      {g.goal && (
        <ul className="grid grid-cols-4 gap-2" aria-label="Milestones">
          {g.milestones.map((m) => (
            <li
              key={m.pct}
              className={
                "flex flex-col items-center gap-1 rounded-2xl py-3 " + (m.reached ? "bg-accent text-accent-fg" : "bg-surface text-muted")
              }
            >
              <span className="text-lg font-semibold tabular-nums">{m.pct}%</span>
              <span className="text-xs">{m.reached ? "✓ done" : "locked"}</span>
            </li>
          ))}
        </ul>
      )}

      {g.months.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-sm font-semibold">Kept each month</h2>
            {g.keptStreak > 0 && (
              <span className="text-sm text-accent">
                {g.keptStreak} {g.keptStreak === 1 ? "month" : "months"} in a row
              </span>
            )}
          </div>
          <div className={card + " gap-4"}>
            <div>
              <p className={"text-3xl font-semibold tabular-nums " + (totalKept < 0 ? "text-danger" : "")}>{signed(totalKept)}</p>
              <p className="text-xs text-muted">
                kept {range}{full.length < g.months.length ? " · * partial month" : ""}
              </p>
            </div>
            <KeptBars months={g.months} />
          </div>
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <h2 className="px-1 text-sm font-semibold">Net worth</h2>
        <div className={card}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-3xl font-semibold tabular-nums">
              {g.netWorth.length ? formatCents(g.netWorth[g.netWorth.length - 1].totalCents) : "n/a"}
            </p>
            {g.netWorthChangeCents !== null && (
              <span className={"text-sm font-semibold tabular-nums " + (g.netWorthChangeCents < 0 ? "text-danger" : "text-accent")}>
                {signed(g.netWorthChangeCents)}
              </span>
            )}
          </div>
          {g.netWorth.length >= 2 ? (
            <>
              <NetWorthLine points={g.netWorth} />
              <div className="flex justify-between text-xs text-muted">
                <span>{shortDate(g.netWorth[0].day)}</span>
                <span>{shortDate(g.netWorth[g.netWorth.length - 1].day)}</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">
              Tracking started {g.netWorth[0] ? shortDate(g.netWorth[0].day) : "today"}. The line fills in daily.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
