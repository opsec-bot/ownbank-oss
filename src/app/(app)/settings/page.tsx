import { eq } from "drizzle-orm";
import { ListGroup, ListRow } from "@/components/list";
import { Notice } from "@/components/ui";
import { requireSession } from "@/lib/auth/request";
import { getUser, totpState } from "@/lib/auth/totp";
import { todayLocal } from "@/lib/bank/normalize";
import { getDb, schema } from "@/lib/db";
import { loadBudgets } from "@/lib/finance/budgets";
import { loadGoalProgress } from "@/lib/finance/goal";
import { timeAgo } from "@/lib/finance/networth";
import { listConnectedApps } from "@/lib/oauth/tokens";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; e?: string }> }) {
  const { ok, e } = await searchParams;
  const me = await requireSession();
  const db = getDb();
  const conn = db.select().from(schema.connections).orderBy(schema.connections.id).limit(1).get();
  const wallets = db.select().from(schema.cryptoWallets).all();
  const plan = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get();
  const today = todayLocal();
  const goal = loadGoalProgress(db, today);
  const budgets = loadBudgets(db, today);
  const meRow = getUser(db, me.id);
  const twoFa = meRow && totpState(meRow) === "on";
  const apps = listConnectedApps(db);
  const ruleCount = db.select().from(schema.rules).all().filter((r) => !r.isDefault).length;
  const broken = conn?.status === "broken";

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <h1 className="text-[28px] font-bold tracking-tight">Settings</h1>
        <form action={logoutAction}>
          <button type="submit" className="pb-1.5 text-sm text-accent">
            Log out
          </button>
        </form>
      </div>

      <Notice ok={ok} e={e} />

      <ListGroup title="Bank">
        <ListRow
          href="/settings/bank"
          icon="bank"
          label={conn ? conn.institutionName : "Connect a bank"}
          sub={conn ? (broken ? "Connection broken: tap to fix" : `Synced ${timeAgo(conn.lastSyncedAt)}`) : undefined}
          value={conn ? (broken ? "Broken" : "Active") : undefined}
          danger={broken}
          broken={broken}
        />
        <ListRow href="/settings/wallets" icon="wallet" label="Wallets" value={String(wallets.length)} />
      </ListGroup>

      <ListGroup title="Money">
        <ListRow href="/settings/savings" icon="piggy" label="Savings plan" value={`${plan?.savePercent ?? 20}% of pay`} />
        <ListRow href="/settings/savings#goal" icon="target" label="Savings goal" value={goal ? `${goal.pct}%` : "Not set"} />
        <ListRow href="/settings/budgets" icon="gauge" label="Budgets" value={budgets.length ? `${budgets.length} set` : "Not set"} />
        <ListRow href="/settings/rules" icon="tag" label="Category rules" value={`${ruleCount} yours`} />
      </ListGroup>

      <ListGroup title="Alerts">
        <ListRow href="/settings/notifications" icon="bell" label="Notifications" />
      </ListGroup>

      <ListGroup title="Account">
        <ListRow href="/settings/security" icon="lock" label="Security" value={twoFa ? "2FA on" : "2FA off"} />
        <ListRow href="/settings/apps" icon="plug" label="Connected apps" value={String(apps.length)} />
      </ListGroup>
    </main>
  );
}
