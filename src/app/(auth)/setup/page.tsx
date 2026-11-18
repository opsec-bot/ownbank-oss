import Image from "next/image";
import { redirect } from "next/navigation";
import { ownerExists } from "@/lib/auth/owner";
import { getDb } from "@/lib/db";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

// Public in the proxy allowlist, but only open while no owner exists.
export default function SetupPage() {
  if (ownerExists(getDb())) redirect("/login");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-8">
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <Image src="/icons/icon-192.png" alt="" width={48} height={48} className="rounded-xl" priority />
        <h1 className="text-2xl font-semibold">ownbank</h1>
        <p className="text-sm text-muted">Set up your ownbank</p>
      </div>
      <SetupForm />
    </main>
  );
}
