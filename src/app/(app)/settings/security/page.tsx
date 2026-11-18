import { BackHeader } from "@/components/list";
import QRCode from "qrcode";
import { requireSession } from "@/lib/auth/request";
import { getUser, otpauthUri, pendingSecret, totpState, unusedRecoveryCount } from "@/lib/auth/totp";
import { getDb } from "@/lib/db";
import { DangerButton, Field } from "@/components/form";
import { card, field, Notice, primaryBtn } from "@/components/ui";
import { cancelSetupAction, disableAction, startSetupAction } from "./actions";
import { ConfirmForm, RegenerateForm } from "./code-forms";

export const dynamic = "force-dynamic";

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ ok?: string; e?: string }> }) {
  const user = await requireSession();
  const { ok, e } = await searchParams;
  const db = getDb();
  const row = getUser(db, user.id);
  const state = row ? totpState(row) : "off";
  const secret = state === "pending" ? pendingSecret(db, user.id) : null;
  const qr = secret ? await QRCode.toDataURL(otpauthUri(secret, user.email), { margin: 1, width: 220 }) : null;

  return (
    <main className="flex flex-col gap-6">
      <BackHeader title="Security" />
      <Notice ok={ok} e={e} />

      <section className={card}>
        <h2 className="font-medium">Two-factor authentication</h2>
        <p className="text-sm text-muted">Status: {state === "on" ? "on" : state === "pending" ? "setup not finished" : "off"}</p>

        {state === "off" && (
          <form action={startSetupAction} className="flex flex-col gap-3">
            <p className="text-sm text-muted">Works with Authy, Google Authenticator, 1Password and similar apps.</p>
            <Field label="Your password">
              <input name="password" type="password" autoComplete="current-password" required className={field} />
            </Field>
            <button type="submit" className={primaryBtn}>
              Enable 2FA
            </button>
          </form>
        )}

        {state === "pending" && qr && secret && (
          <>
            <p className="text-sm text-muted">Scan this in your authenticator app, then enter the code it shows.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="2FA QR code" width={220} height={220} className="self-center rounded-lg bg-white" />
            <p className="text-xs text-muted">
              Or type this key by hand: <code className="break-all text-sm text-text">{secret.match(/.{1,4}/g)?.join(" ")}</code>
            </p>
            <ConfirmForm />
            <form action={cancelSetupAction}>
              <button type="submit" className="py-2 text-sm text-muted active:opacity-70">
                Cancel setup
              </button>
            </form>
          </>
        )}

        {state === "on" && (
          <>
            <p className="text-sm text-muted">{unusedRecoveryCount(db, user.id)} recovery codes left.</p>
            <RegenerateForm />
            <details>
              <summary className="cursor-pointer py-2 text-sm text-danger">Turn off 2FA</summary>
              <form action={disableAction} className="mt-3 flex flex-col gap-3">
                <Field label="Password">
                  <input name="password" type="password" autoComplete="current-password" required className={field} />
                </Field>
                <Field label="Current code">
                  <input name="code" autoComplete="one-time-code" required maxLength={20} className={field} />
                </Field>
                <DangerButton>Turn off 2FA</DangerButton>
              </form>
            </details>
          </>
        )}
      </section>
    </main>
  );
}
