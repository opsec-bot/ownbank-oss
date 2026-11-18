import { Field, MoneyInput, Toggle } from "@/components/form";
import { IconTile } from "@/components/list";
import { Notice, Tile, field, primaryBtn, smallBtn } from "@/components/ui";
import { requireSession } from "@/lib/auth/request";
import { todayLocal } from "@/lib/bank/normalize";
import { getDb } from "@/lib/db";
import { loadBills, type BillItem } from "@/lib/finance/bills";
import { merchantName } from "@/lib/finance/merchant-name";
import { formatCents } from "@/lib/finance/networth";
import { addBillAction, ignoreBillAction, removeManualBillAction } from "./actions";

export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function when(i: BillItem): string {
  if (i.nextDate === null || i.daysUntil === null) return "no date";
  const md = `${i.nextDate.slice(5, 7)}/${i.nextDate.slice(8, 10)}`;
  if (i.daysUntil === 0) return `${md} · today`;
  if (i.daysUntil === 1) return `${md} · tomorrow`;
  return `${md} · in ${i.daysUntil} days`;
}

const noMarker = "list-none [&::-webkit-details-marker]:hidden";

function Row({ i, income }: { i: BillItem; income?: boolean }) {
  return (
    <li>
      <details className="group">
        <summary className={"flex cursor-pointer flex-col gap-1 px-4 py-3 active:bg-bg " + noMarker}>
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{i.manual ? i.name : merchantName(i.name)}</span>
            <span className="shrink-0 font-semibold tabular-nums">
              {i.variableAmount ? "≈ " : ""}
              {formatCents(Math.abs(i.avgAmountCents))}
            </span>
          </span>
          <span className="truncate text-xs text-muted">
            {i.cadence} · {when(i)}
            {i.variableAmount ? " · varies" : ""}
            {i.manual ? " · added by you" : ""}
          </span>
          {(i.priceUp || i.isNew || i.isSubscription) && (
            <span className="flex flex-wrap gap-1.5 text-[11px]">
              {i.priceUp && <span className="rounded-full border border-danger px-1.5 text-danger">Price up {i.priceUpPct}%</span>}
              {i.isNew && <span className="rounded-full border border-accent px-1.5 text-accent">New</span>}
              {i.isSubscription && <span className="rounded-full border border-border px-1.5 text-muted">Subscription</span>}
            </span>
          )}
        </summary>
        <div className="flex items-center justify-between gap-3 px-4 pb-3">
          <p className="min-w-0 truncate text-xs text-muted">{i.name}</p>
          {i.manual ? (
            <form action={removeManualBillAction}>
              <input type="hidden" name="key" value={i.merchantKey} />
              <button type="submit" className="px-1 py-1 text-sm text-danger active:opacity-70">
                Remove
              </button>
            </form>
          ) : (
            <form action={ignoreBillAction}>
              <input type="hidden" name="key" value={i.merchantKey} />
              <input type="hidden" name="ignored" value="1" />
              <button type="submit" className="px-1 py-1 text-sm text-muted active:opacity-70">
                {income ? "Not income" : "Not a bill"}
              </button>
            </form>
          )}
        </div>
      </details>
    </li>
  );
}

export default async function BillsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSession();
  const sp = await searchParams;
  const today = todayLocal();
  const b = loadBills(getDb(), today);
  const dueTotal = b.dueSoon.reduce((s, i) => s - i.avgAmountCents, 0);

  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-[28px] font-bold tracking-tight">Bills</h1>
      <Notice ok={first(sp.ok)} e={first(sp.e)} />

      <div className="grid grid-cols-2 gap-3">
        <Tile label="Per month" value={formatCents(b.monthlyTotalCents)} sub={`${b.items.length} recurring`} />
        <Tile label="Due in 7 days" value={formatCents(dueTotal)} sub={`${b.dueSoon.length} bill${b.dueSoon.length === 1 ? "" : "s"}`} />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-sm font-medium">All recurring, by next date</h2>
        {b.items.length === 0 ? (
          <p className="rounded-2xl bg-surface p-4 text-sm text-muted">
            Nothing recurring found yet. It needs three matching charges.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl bg-surface">
            {b.items.map((i) => (
              <Row key={i.merchantKey} i={i} />
            ))}
          </ul>
        )}
      </section>

      {b.income.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-medium">Recurring income</h2>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl bg-surface">
            {b.income.map((i) => (
              <Row key={i.merchantKey} i={i} income />
            ))}
          </ul>
        </section>
      )}

      {b.ignored.length > 0 && (
        <details className="rounded-2xl bg-surface">
          <summary className={"cursor-pointer px-4 py-3 text-sm font-medium text-accent active:bg-bg " + noMarker}>Hidden ({b.ignored.length})</summary>
          <ul className="flex flex-col divide-y divide-border">
            {b.ignored.map((i) => (
              <li key={i.merchantKey} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0 truncate">{i.manual ? i.name : merchantName(i.name)}</span>
                <form action={ignoreBillAction}>
                  <input type="hidden" name="key" value={i.merchantKey} />
                  <input type="hidden" name="ignored" value="0" />
                  <button type="submit" className={smallBtn}>
                    Restore
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="group overflow-hidden rounded-2xl bg-surface">
        <summary className={"flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2.5 active:bg-bg " + noMarker}>
          <IconTile name="plus" />
          <span className="flex-1">Add one by hand</span>
        </summary>
        <form action={addBillAction} className="flex flex-col gap-3 px-4 pb-4">
          <Field label="Name">
            <input name="name" required maxLength={60} className={field} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount">
              <MoneyInput name="amount" required />
            </Field>
            <Field label="Repeats">
              <select name="cadence" defaultValue="monthly" className={field}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </Field>
          </div>
          <Field label="Next date">
            <input name="next" type="date" required className={field} />
          </Field>
          <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
            <span>This is income, not a bill</span>
            <Toggle name="income" value="1" />
          </label>
          <button type="submit" className={primaryBtn}>
            Add
          </button>
        </form>
      </details>
    </main>
  );
}
