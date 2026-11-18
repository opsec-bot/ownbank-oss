import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth/cookie";
import { safeNext } from "@/lib/auth/pending";
import { validateSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { consentCsrf, parseAuthorize, redirectWith, SCOPE_LABELS } from "@/lib/oauth/authorize";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// Public in the proxy allowlist; the owner session is checked here. No session -> login, then back to this exact URL
// (login adds the 2FA step when it is on).
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const db = getDb();
  if (!token || !validateSession(token, db)) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const one = first(v);
      if (one !== undefined) qs.set(k, one);
    }
    const next = safeNext(`/oauth/authorize?${qs.toString()}`);
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }

  const p = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, first(v)]));
  const parsed = parseAuthorize(p, db);
  if (!parsed.ok) {
    if (!parsed.fatal) {
      redirect(redirectWith(parsed.redirectUri, { error: parsed.error, error_description: parsed.description, state: parsed.state }));
    }
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 px-6">
        <h1 className="text-[28px] font-bold tracking-tight">Cannot connect</h1>
        <p role="alert" className="text-sm text-danger">
          {parsed.message}
        </p>
      </main>
    );
  }

  const r = parsed.req;
  const host = new URL(r.redirectUri).host;
  const hidden: Record<string, string> = {
    client_id: r.client.clientId,
    redirect_uri: r.redirectUri,
    code_challenge: r.codeChallenge,
    scope: r.scopes.join(" "),
    csrf: consentCsrf(token!),
  };
  if (r.state) hidden.state = r.state;
  if (r.resource) hidden.resource = r.resource;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Connect to ownbank</h1>
      <p className="text-base">
        <strong>{r.client.clientName ?? "An app"}</strong> wants to use your finance data.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Returns to</dt>
        <dd className="break-all">{host}</dd>
      </dl>
      <ul className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm">
        {r.scopes.map((s) => (
          <li key={s}>{SCOPE_LABELS[s]}</li>
        ))}
      </ul>
      <form method="post" action="/api/oauth/authorize" className="flex flex-col gap-3">
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <button type="submit" name="decision" value="approve" className="rounded-lg bg-accent px-4 py-3 font-medium text-accent-fg">
          Approve
        </button>
        <button type="submit" name="decision" value="deny" className="rounded-lg border border-border bg-surface px-4 py-3">
          Deny
        </button>
      </form>
      <p className="text-xs text-muted">You can disconnect any app later in Settings.</p>
    </main>
  );
}
