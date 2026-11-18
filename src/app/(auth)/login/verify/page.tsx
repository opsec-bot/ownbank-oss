import Image from "next/image";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPendingLogin, PENDING_COOKIE } from "@/lib/auth/pending";
import { VerifyForm } from "./verify-form";

export const dynamic = "force-dynamic";

// Public in the proxy allowlist, but without a valid pending-login cookie it just bounces back to the login page.
export default async function VerifyPage() {
  const pending = getPendingLogin((await cookies()).get(PENDING_COOKIE)?.value);
  if (!pending) redirect("/login");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <Image src="/icons/icon-192.png" alt="" width={48} height={48} className="rounded-xl" priority />
        <h1 className="text-2xl font-semibold">Two-factor code</h1>
        <p className="text-sm text-muted">Enter the code before it expires (5 minutes).</p>
      </div>
      <VerifyForm />
    </main>
  );
}
