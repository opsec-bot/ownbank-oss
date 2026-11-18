import { BackHeader, IconTile } from "@/components/list";
import { DangerButton, Field } from "@/components/form";
import { Notice, card, field, primaryBtn, smallBtn } from "@/components/ui";
import { requireSession } from "@/lib/auth/request";
import { getDb, schema } from "@/lib/db";
import { formatCents } from "@/lib/finance/networth";
import { addWalletAction, removeWalletAction, setWalletRoleAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function WalletsPage({ searchParams }: { searchParams: Promise<{ ok?: string; e?: string }> }) {
  await requireSession();
  const { ok, e } = await searchParams;
  const heliusOn = Boolean(process.env.HELIUS_RPC_URL);
  const wallets = getDb().select().from(schema.cryptoWallets).orderBy(schema.cryptoWallets.id).all();

  return (
    <main className="flex flex-col gap-5">
      <BackHeader title="Wallets" />
      <Notice ok={ok} e={e} />

      <section className="flex flex-col gap-1.5">
        {wallets.length === 0 ? (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-muted">No wallets yet</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-2xl bg-surface">
            {wallets.map((w) => (
              <li key={w.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center gap-3">
                  <IconTile name="wallet" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{w.label || "Wallet"}</span>
                    <span className="block truncate text-xs text-muted">
                      {w.address.slice(0, 4)}…{w.address.slice(-4)}
                      {w.lastError ? ` · ${w.lastError}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{w.updatedAt ? formatCents(w.totalUsdCents) : "n/a"}</span>
                </div>
                <div className="flex items-center gap-2 pl-[42px]">
                  <form action={setWalletRoleAction}>
                    <input type="hidden" name="id" value={w.id} />
                    <input type="hidden" name="role" value={w.role === "trading" ? "savings" : "trading"} />
                    <button type="submit" className={smallBtn}>
                      {w.role === "trading" ? "Count as savings" : "Mark as trading"}
                    </button>
                  </form>
                  <form action={removeWalletAction} className="ml-auto">
                    <input type="hidden" name="id" value={w.id} />
                    <DangerButton>Remove</DangerButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="px-1 text-xs text-muted">Trading wallets count as already spent.</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h2 className="px-1 text-sm font-semibold">Add wallet</h2>
        {!heliusOn ? (
          <div className={card}>
            <p className="text-sm text-muted">
              Crypto wallets are off. They need a Helius RPC URL. Get a free key at{" "}
              <a href="https://dashboard.helius.dev" target="_blank" rel="noreferrer" className="text-accent">
                dashboard.helius.dev
              </a>
              , then set <code className="rounded bg-bg px-1 text-text">HELIUS_RPC_URL</code> in your .env and restart.
            </p>
          </div>
        ) : (
        <form action={addWalletAction} className={card}>
          <Field label="Label">
            <input name="label" maxLength={60} className={field} />
          </Field>
          <Field label="Solana address">
            <input name="address" required spellCheck={false} autoComplete="off" autoCapitalize="none" className={field} />
          </Field>
          <button type="submit" className={primaryBtn}>
            Add wallet
          </button>
        </form>
        )}
      </section>
    </main>
  );
}
