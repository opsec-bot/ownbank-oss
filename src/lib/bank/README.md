# bank

SimpleFIN Bridge: client, connect flow and sync.

- `simplefin.ts`: setup token claim (needs a normal User-Agent), access URL to Basic auth, `/accounts?version=2` fetch, exact money parsing to cents, last-four extraction.
- `connect.ts`: stores the access URL encrypted (`connections.access_token_enc`) and runs a first sync.
- `sync.ts`: `runSync(trigger)` (in-process mutex, `sync_runs` row), upsert, pending reconcile, categorization, recurring rebuild, 20 requests/day budget guard.
- `normalize.ts`: merchant keys and dates in the app timezone.

SimpleFIN limits: 24 requests/day, 90 days per request. The timer runs every 2 hours (max 12/day), app-open sync only when data is over 60 minutes old.
The access URL is a secret: never log it or send it to the browser.
