# push

Web Push (VAPID) for the owner's phone. Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (`npm run gen:vapid`).

- `send.ts`: `notify()` is the one entry point. It checks the per-kind toggle, dedupes by key, logs to `notifications`, and sends or queues. `sendPush()` sends to every device and deletes subscriptions answering 404/410. `notifications.delivered`: 0 queued, 1 sent, 2 undeliverable.
- `time.ts`: app-timezone clock, quiet hours 10 PM to 7 AM (disconnect and test ignore them).
- `triggers.ts`: income save, large transaction, low balance, disconnect, budgets, goal milestones. `runSyncTriggers` runs after every sync.
- `schedule.ts` (pure decisions) and `scheduler.ts` (once a minute): 7 AM flush of queued pushes, 8:15 AM auto digest if Claude has not posted. `DISABLE_SCHEDULER=1` stops it.
- `/api/push/subscribe`: POST stores a subscription, DELETE removes it. Session required.
- The service worker is `public/sw.js`: push and click only, it caches nothing.
