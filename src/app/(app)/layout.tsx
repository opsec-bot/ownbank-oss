import { AppFrame } from "@/components/app-frame";
import { SideNav, TabBar } from "@/components/tab-bar";
import { requireSession } from "@/lib/auth/request";
import { runSync, shouldOpenSync } from "@/lib/bank/sync";
import { getDb } from "@/lib/db";

// Every page in this group needs a valid session. Auth is checked here (Node), not only in middleware.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  // Refresh in the background when the data is stale. Not awaited: the page renders without waiting for the bank.
  if (shouldOpenSync(getDb())) {
    void runSync("open").catch((e) => console.error("open sync failed:", e instanceof Error ? e.message : "unknown"));
  }
  return <AppFrame nav={<TabBar />} sidebar={<SideNav />}>{children}</AppFrame>;
}
