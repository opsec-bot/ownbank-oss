import { BackHeader, IconTile } from "@/components/list";
import { dangerText } from "@/components/form";
import { Notice } from "@/components/ui";
import { requireSession } from "@/lib/auth/request";
import { getDb } from "@/lib/db";
import { timeAgo } from "@/lib/finance/networth";
import { resourceUrl } from "@/lib/oauth/config";
import { listConnectedApps } from "@/lib/oauth/tokens";
import { revokeAppAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AppsPage({ searchParams }: { searchParams: Promise<{ ok?: string; e?: string }> }) {
  await requireSession();
  const { ok, e } = await searchParams;
  const apps = listConnectedApps(getDb());

  return (
    <main className="flex flex-col gap-5">
      <BackHeader title="Connected apps" />
      <Notice ok={ok} e={e} />
      {apps.length === 0 ? (
        <section className="flex flex-col gap-3 rounded-2xl bg-surface px-4 py-4">
          <p className="font-semibold">Connect Claude</p>
          <p className="text-sm text-muted">
            Ask Claude &quot;can I afford this?&quot; or get a morning digest. In Claude, add a custom connector with this URL,
            then sign in here to approve it.
          </p>
          <code className="select-all break-all rounded-xl bg-bg px-3 py-2.5 text-sm">{resourceUrl()}</code>
          <p className="text-xs text-muted">Read only by default. Revoke any app here at any time.</p>
        </section>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-2xl bg-surface">
          {apps.map((a) => (
            <li key={a.clientId} className="flex items-center gap-3 px-4 py-3">
              <IconTile name="plug" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{a.name}</span>
                <span className="block truncate text-xs text-muted">
                  {a.scope?.includes("finance:write") ? "Read and write" : "Read only"} · used {timeAgo(a.lastUsedAt)}
                </span>
              </span>
              <form action={revokeAppAction}>
                <input type="hidden" name="clientId" value={a.clientId} />
                <button type="submit" className={dangerText}>
                  Revoke
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
