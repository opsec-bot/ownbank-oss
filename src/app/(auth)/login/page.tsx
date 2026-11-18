import Image from "next/image";
import { redirect } from "next/navigation";
import { ownerExists } from "@/lib/auth/owner";
import { safeNext } from "@/lib/auth/pending";
import { getDb } from "@/lib/db";
import { LoginForm } from "./login-form";

// Must render per request: the "no owner yet, go to /setup" check would otherwise be baked in at build time.
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!ownerExists(getDb())) redirect("/setup");
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <Image src="/icons/icon-192.png" alt="" width={48} height={48} className="rounded-xl" priority />
        <h1 className="text-2xl font-semibold">ownbank</h1>
        <p className="text-sm text-muted">Your money, on your server.</p>
      </div>
      <LoginForm next={safeNext(next) ?? undefined} />
    </main>
  );
}
