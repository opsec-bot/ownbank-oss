import { BackHeader, IconTile } from "@/components/list";
import Link from "next/link";
import { DangerButton, Field, MoneyInput, summaryCls } from "@/components/form";
import { Notice, field, primaryBtn, secondaryBtn, smallBtn } from "@/components/ui";
import { requireSession } from "@/lib/auth/request";
import { todayLocal } from "@/lib/bank/normalize";
import { getDb, schema } from "@/lib/db";
import { loadBudgets, suggestLimits } from "@/lib/finance/budgets";
import { earliestTxDate } from "@/lib/finance/stats";
import { confirmSuggestionAction, removeBudgetAction, setBudgetAction } from "./actions";

export const dynamic = "force-dynamic";

const dollars = (cents: number) => (cents / 100).toFixed(0);
const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ ok?: string; e?: string; suggest?: string }> }) {
  await requireSession();
  const { ok, e, suggest } = await searchParams;
  const db = getDb();
  const today = todayLocal();
  const budgets = loadBudgets(db, today);
  const have = new Set(budgets.map((b) => b.categoryId));
  const options = db
    .select()
    .from(schema.categories)
    .orderBy(schema.categories.name)
    .all()
    .filter((c) => c.kind === "expense" && !have.has(c.id));
  const suggestions = suggest ? suggestLimits(db, today, earliestTxDate(db)) : [];

  return (
    <main className="flex flex-col gap-4">
      <BackHeader title="Budgets" />
      <Notice ok={ok} e={e} />

      {budgets.length === 0 && <p className="rounded-2xl bg-surface p-4 text-sm text-muted">No budgets yet.</p>}
      {budgets.length > 0 && (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl bg-surface">
          {budgets.map((b) => {
            const over = b.spentCents > b.limitCents;
            return (
              <li key={b.categoryId}>
                <details>
                  <summary className={"flex flex-col gap-2 px-4 py-3 active:bg-bg " + summaryCls}>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate">{b.name}</span>
                      <span className="shrink-0 tabular-nums text-muted">{money(b.limitCents)}/mo</span>
                    </span>
                    <span className="h-1.5 rounded-full bg-bg">
                      <span
                        className={"block h-1.5 rounded-full " + (over ? "bg-danger" : "bg-accent")}
                        style={{ width: `${Math.min(100, Math.max(b.spentCents > 0 ? 2 : 0, b.pct))}%` }}
                      />
                    </span>
                    <span className={"text-xs tabular-nums " + (over ? "text-danger" : "text-muted")}>
                      {money(b.spentCents)} of {money(b.limitCents)}
                    </span>
                  </summary>
                  <div className="flex flex-col gap-2 px-4 pb-3">
                    <form action={setBudgetAction} className="flex items-center gap-2">
                      <input type="hidden" name="category" value={b.categoryId} />
                      <div className="min-w-0 flex-1">
                        <MoneyInput name="limit" defaultCents={b.limitCents} label={`${b.name} monthly limit`} />
                      </div>
                      <button type="submit" className={smallBtn + " h-11"}>
                        Save
                      </button>
                    </form>
                    <form action={removeBudgetAction}>
                      <input type="hidden" name="category" value={b.categoryId} />
                      <DangerButton>Remove</DangerButton>
                    </form>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      {options.length > 0 && (
        <details className="overflow-hidden rounded-2xl bg-surface">
          <summary className={"flex min-h-12 items-center gap-3 px-4 py-2.5 active:bg-bg " + summaryCls}>
            <IconTile name="plus" />
            <span className="flex-1">Add a budget</span>
          </summary>
          <form action={setBudgetAction} className="flex flex-col gap-3 px-4 pb-4">
            <Field label="Category">
              <select name="category" className={field}>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Monthly limit">
              <MoneyInput name="limit" required />
            </Field>
            <button type="submit" className={primaryBtn}>
              Add
            </button>
          </form>
        </details>
      )}

      {suggest ? (
        <section className="flex flex-col gap-1.5">
          <h2 className="px-1 text-sm font-semibold">Suggested limits</h2>
          {suggestions.length === 0 ? (
            <p className="rounded-2xl bg-surface p-4 text-sm text-muted">No suggestions: not enough full months of history, or every category already has a budget.</p>
          ) : (
            <>
              <p className="px-1 text-xs text-muted">Average of the last {suggestions[0].months} full month(s), rounded to $10. Confirm each one you want.</p>
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl bg-surface">
                {suggestions.map((s) => (
                  <li key={s.categoryId} className="px-4 py-2.5">
                    <form action={confirmSuggestionAction} className="flex items-center justify-between gap-3">
                      <input type="hidden" name="category" value={s.categoryId} />
                      <input type="hidden" name="limit" value={dollars(s.suggestedCents)} />
                      <span className="min-w-0">
                        <span className="block">{s.name}</span>
                        <span className="block text-xs text-muted">avg ${dollars(s.avgCents)}</span>
                      </span>
                      <button type="submit" className={smallBtn + " shrink-0"}>
                        Set ${dollars(s.suggestedCents)}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : (
        <Link href="/settings/budgets?suggest=1" className={secondaryBtn}>
          Suggest limits
        </Link>
      )}
    </main>
  );
}
