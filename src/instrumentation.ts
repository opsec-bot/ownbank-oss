// Runs once when the server starts: apply pending migrations so a fresh volume (or restore) is ready,
// then start the background sync timer and the notification scheduler.
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Secrets first: anything missing from the environment is loaded from (or generated into) secrets.json next to the database.
  try {
    const { ensureSecrets } = await import("./lib/secrets");
    ensureSecrets();
  } catch (e) {
    console.error("secrets setup failed:", e instanceof Error ? e.message : "unknown error");
    throw e;
  }
  const { getDb } = await import("./lib/db");
  const db = getDb();
  // First run: no owner yet, so print a one-time setup code for /setup.
  try {
    const { prepareSetupCode, setupBanner } = await import("./lib/auth/setup");
    const code = prepareSetupCode(db);
    if (code && process.env.NODE_ENV !== "test") console.log(setupBanner(code, process.env.APP_URL || "http://localhost:3000"));
  } catch (e) {
    console.error("setup code failed:", e instanceof Error ? e.message : "unknown error");
  }
  // One-time data tasks queued by migrations (for example re-categorizing after new default rules).
  try {
    const { runPendingTasks } = await import("./lib/finance/recategorize");
    runPendingTasks(db);
  } catch (e) {
    console.error("pending data tasks failed:", e instanceof Error ? e.message : "unknown error");
  }

  if (process.env.NODE_ENV === "test") return;

  // Notification scheduler: 8:15 AM auto digest, 7 AM flush of quiet-hour pushes. DISABLE_SCHEDULER=1 turns it off.
  if (process.env.DISABLE_SCHEDULER !== "1") {
    try {
      const { startScheduler } = await import("./lib/push/scheduler");
      startScheduler();
    } catch (e) {
      console.error("scheduler failed to start:", e instanceof Error ? e.message : "unknown error");
    }
  }

  if (process.env.DISABLE_SYNC_TIMER === "1") return;
  const g = globalThis as unknown as { __ownbankTimer?: boolean };
  if (g.__ownbankTimer) return; // dev hot reload can call register again
  g.__ownbankTimer = true;

  const tick = async () => {
    try {
      const { runSync } = await import("./lib/bank/sync");
      await runSync("cron");
    } catch (e) {
      console.error("scheduled sync failed:", e instanceof Error ? e.message : "unknown error");
    }
  };

  // Random first delay (1 to 119 minutes) so runs land on a random minute, then every 2 hours: at most 12/day.
  const firstDelay = (1 + Math.floor(Math.random() * 118)) * 60 * 1000;
  const first = setTimeout(() => {
    void tick();
    setInterval(() => void tick(), TWO_HOURS_MS).unref();
  }, firstDelay);
  first.unref();
}
