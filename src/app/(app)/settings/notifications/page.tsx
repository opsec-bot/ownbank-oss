import { eq } from "drizzle-orm";
import Link from "next/link";
import { BackHeader } from "@/components/list";
import { Field, MoneyInput, ToggleRow } from "@/components/form";
import { PushControls } from "@/components/push-controls";
import { Notice, card, primaryBtn, secondaryBtn } from "@/components/ui";
import { zoneLabel } from "@/lib/timezone";
import { requireSession } from "@/lib/auth/request";
import { getDb, schema } from "@/lib/db";
import { timeAgo } from "@/lib/finance/networth";
import { deviceLabel } from "@/lib/push/device";
import { recentNotifications, TOGGLE_KINDS, ntfyFromEnv, vapidFromEnv } from "@/lib/push/send";
import { saveNotificationSettingsAction, sendTestPushAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ ok?: string; e?: string }> }) {
  await requireSession();
  const { ok, e } = await searchParams;
  const db = getDb();
  const plan = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get();
  const devices = db.select().from(schema.pushSubscriptions).orderBy(schema.pushSubscriptions.createdAt).all();
  const alerts = recentNotifications(db, 12);
  const vapid = vapidFromEnv();
  const ntfyOn = ntfyFromEnv() !== null;
  const toggles: Record<string, boolean> = plan
    ? {
        digest: plan.pushDigest,
        income_save: plan.pushIncomeSave,
        low_balance: plan.pushLowBalance,
        disconnect: plan.pushDisconnect,
        large_tx: plan.pushLargeTx,
        budget_pace: plan.pushBudgetPace,
        goal: plan.pushGoal,
      }
    : {};

  return (
    <main className="flex flex-col gap-5">
      <BackHeader title="Notifications" />
      <Notice ok={ok} e={e} />

      <section className="flex flex-col gap-1.5">
        <h2 className="px-1 text-sm font-semibold">Devices</h2>
        <div className={card}>
          {vapid && <PushControls publicKey={vapid.publicKey} />}
          {ntfyOn && (
            <p className="text-sm">
              <span className="text-accent">&#10003;</span> ntfy on
            </p>
          )}
          {!vapid && !ntfyOn && (
            <p className="text-sm text-muted">
              Push is off. Set <code className="rounded bg-bg px-1 text-text">NTFY_TOPIC</code> (works with the free ntfy app), or set{" "}
              <code className="rounded bg-bg px-1 text-text">VAPID_PUBLIC_KEY</code> and{" "}
              <code className="rounded bg-bg px-1 text-text">VAPID_PRIVATE_KEY</code> (run <code className="rounded bg-bg px-1 text-text">npm run gen:vapid</code>), then restart.
            </p>
          )}
          {devices.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {devices.map((d) => (
                <li key={d.endpoint} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{deviceLabel(d.userAgent)}</span>
                  <span className="text-muted">{timeAgo(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
          {(devices.length > 0 || ntfyOn) && (
            <form action={sendTestPushAction}>
              <button type="submit" className={secondaryBtn}>
                Send test
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="px-1 text-sm font-semibold">Alert me about</h2>
        <form action={saveNotificationSettingsAction} className="flex flex-col gap-3">
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl bg-surface">
            {TOGGLE_KINDS.map((k) => (
              <ToggleRow key={k.kind} name={k.kind} label={k.label} defaultChecked={toggles[k.kind] ?? true} />
            ))}
          </ul>
          <div className={card}>
            <Field label="Large transaction threshold">
              <MoneyInput name="threshold" defaultCents={plan?.largeTxThresholdCents ?? 20000} />
            </Field>
          </div>
          <button type="submit" className={primaryBtn}>
            Save
          </button>
        </form>
        <p className="px-1 text-xs text-muted">Quiet 10 PM to 7 AM {zoneLabel()}.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="px-1 text-sm font-semibold">Recent</h2>
        {alerts.length === 0 ? (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-muted">Nothing sent yet</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-2xl bg-surface">
            {alerts.map((a) => (
              <li key={a.id}>
                <Link href={a.url} className="flex flex-col gap-0.5 px-4 py-3 active:bg-bg">
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{a.title}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {timeAgo(a.createdAt)}
                      {a.delivered === 0 ? " · waiting" : a.delivered === 2 ? " · not delivered" : ""}
                    </span>
                  </span>
                  <span className="line-clamp-2 whitespace-pre-line text-sm text-muted">{a.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
