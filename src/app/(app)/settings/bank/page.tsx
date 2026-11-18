import { BackHeader } from "@/components/list";
import { Field, summaryCls } from "@/components/form";
import { Notice, card, primaryBtn, textareaField } from "@/components/ui";
import { requireSession } from "@/lib/auth/request";
import { getDb, schema } from "@/lib/db";
import { timeAgo } from "@/lib/finance/networth";
import { connectAction, syncNowAction } from "../actions";

export const dynamic = "force-dynamic";

function TokenForm({ cta }: { cta: string }) {
  return (
    <form action={connectAction} className="flex flex-col gap-3">
      <Field label="SimpleFIN setup token">
        <textarea name="token" rows={3} required autoComplete="off" spellCheck={false} className={textareaField} />
      </Field>
      <button type="submit" className={primaryBtn}>
        {cta}
      </button>
    </form>
  );
}

export default async function BankPage({ searchParams }: { searchParams: Promise<{ ok?: string; e?: string }> }) {
  await requireSession();
  const { ok, e } = await searchParams;
  const conn = getDb().select().from(schema.connections).orderBy(schema.connections.id).limit(1).get();

  return (
    <main className="flex flex-col gap-5">
      <BackHeader title="Bank" />
      <Notice ok={ok} e={e} />
      {!conn ? (
        <section className={card}>
          <h2 className="font-medium">Connect your bank</h2>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted">
            <li>
              Sign up at{" "}
              <a href="https://beta-bridge.simplefin.org" target="_blank" rel="noreferrer" className="text-accent">
                beta-bridge.simplefin.org
              </a>{" "}
              (about $15 a year, read-only).
            </li>
            <li>Link your bank there, then create a setup token.</li>
            <li>Paste the token below. It works once.</li>
          </ol>
          <TokenForm cta="Connect" />
        </section>
      ) : (
        <>
          <section className={card}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">Bank</dt>
              <dd>{conn.institutionName}</dd>
              <dt className="text-muted">Status</dt>
              <dd className={conn.status === "broken" ? "text-danger" : ""}>{conn.status === "broken" ? "Broken" : "Active"}</dd>
              <dt className="text-muted">Last synced</dt>
              <dd>{timeAgo(conn.lastSyncedAt)}</dd>
              {conn.lastError && (
                <>
                  <dt className="text-muted">Last error</dt>
                  <dd className="text-danger">{conn.lastError}</dd>
                </>
              )}
            </dl>
            <form action={syncNowAction}>
              <button type="submit" className={primaryBtn}>
                Sync now
              </button>
            </form>
          </section>
          <details id="replace" open={conn.status === "broken"} className={card}>
            <summary className={summaryCls + " font-medium"}>Replace connection</summary>
            <div className="mt-3">
              <TokenForm cta="Replace connection" />
            </div>
          </details>
        </>
      )}
    </main>
  );
}
