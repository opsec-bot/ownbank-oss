import { eq } from "drizzle-orm";
import { BackHeader } from "@/components/list";
import { DangerButton, Field, MoneyInput, PercentInput } from "@/components/form";
import { Notice, card, field, primaryBtn } from "@/components/ui";
import { requireSession } from "@/lib/auth/request";
import { getDb, schema } from "@/lib/db";
import { getGoal } from "@/lib/finance/goal";
import { clearGoalAction, saveGoalAction, savePlanSettingsAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SavingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; e?: string }> }) {
  await requireSession();
  const { ok, e } = await searchParams;
  const db = getDb();
  const plan = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get();
  const goal = getGoal(db);

  return (
    <main className="flex flex-col gap-5">
      <BackHeader title="Savings" />
      <Notice ok={ok} e={e} />

      <section className="flex flex-col gap-1.5">
        <h2 className="px-1 text-sm font-semibold">Plan</h2>
        <form action={savePlanSettingsAction} className={card}>
          <Field label="Save % of each paycheck">
            <PercentInput name="percent" defaultValue={plan?.savePercent ?? 20} />
          </Field>
          <Field label="Keep in checking (buffer)">
            <MoneyInput name="buffer" defaultCents={plan?.bufferCents ?? 5000} />
          </Field>
          <button type="submit" className={primaryBtn}>
            Save plan
          </button>
        </form>
      </section>

      <section id="goal" className="flex scroll-mt-4 flex-col gap-1.5">
        <h2 className="px-1 text-sm font-semibold">Goal</h2>
        <div className={card}>
          <form action={saveGoalAction} className="flex flex-col gap-3">
            <Field label="Name">
              <input name="name" required maxLength={60} defaultValue={goal?.name ?? ""} className={field} />
            </Field>
            <Field label="Target">
              <MoneyInput name="target" required defaultCents={goal?.targetCents} />
            </Field>
            <Field label="By (optional)">
              <input name="date" type="date" defaultValue={goal?.targetDate ?? ""} className={field} />
            </Field>
            <Field label="Counts">
              <select name="counts" defaultValue={goal?.counts ?? "stable"} className={field}>
                <option value="stable">Stablecoins in savings wallets</option>
                <option value="all_savings">All savings wallet value (stable + SOL)</option>
              </select>
            </Field>
            <button type="submit" className={primaryBtn}>
              {goal ? "Update goal" : "Set goal"}
            </button>
          </form>
          {goal && (
            <form action={clearGoalAction}>
              <DangerButton>Remove goal</DangerButton>
            </form>
          )}
        </div>
        <p className="px-1 text-xs text-muted">Trading wallets never count.</p>
      </section>
    </main>
  );
}
