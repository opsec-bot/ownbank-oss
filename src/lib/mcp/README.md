# mcp

MCP server for Claude at `POST /api/mcp` (Streamable HTTP, stateless, JSON responses). Built on
`@modelcontextprotocol/sdk` with the web-standard transport: every request gets a fresh `McpServer` and transport,
no session ids. `GET` answers 405 (nothing to push); auth still runs first so a probe gets the 401 challenge.

Files: `auth.ts` (bearer check, scopes, rate limit), `tools.ts` (all tools), `server.ts` (registration, server
instructions), `format.ts` (dollar strings, masking). The OAuth side lives in `src/lib/oauth/`.

## Auth

`Authorization: Bearer <token>` where the token is either

- `MCP_TOKEN` (static, constant-time compare; unset = static auth off). Scopes: read, plus write when `MCP_WRITE_ENABLED`.
- an OAuth access token from the built-in authorization server (opaque, SHA-256 stored, 1 h). Scopes: what the owner approved.

Failure is `401` with `WWW-Authenticate: Bearer resource_metadata="<APP_URL>/.well-known/oauth-protected-resource"`.
Limits: 60 requests per minute per token (`429` + `Retry-After`), plus 30 failed attempts per minute per IP.

## Output rules

- Money is a dollar string with 2 decimals (`"-12.30"`); keys end in `Usd`. Negative = money out.
- Dates are `YYYY-MM-DD`, timestamps ISO 8601.
- Every string is masked: runs of 5+ digits keep only the last four, card-like numbers become `****1234`.
- Transactions: date, amount, description (80 chars), merchant, category, account name + last four, status.
- Never returned: provider access URLs, certs, full account or wallet numbers (last four only), raw provider data.
- Errors the caller can fix come back as `isError` text; internal errors are logged by name only.

Every tool has a title and `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`.

## Tools

Read (scope `finance:read`):

| Tool | Inputs | Returns |
| --- | --- | --- |
| `get_balances` | none | Bank accounts, savings wallets (stable/volatile), trading wallets marked `counted: false`, net worth |
| `list_transactions` | `start`, `end`, `category?`, `search?`, `account?`, `direction?` (in/out), `limit` (1-500, default 50) | Transactions, newest first, with total match count |
| `spending_by_category` | `start`, `end` | Spend per category with share |
| `spending_by_merchant` | `start`, `end`, `category?`, `limit` (default 20) | Top merchants |
| `compare_periods` | `a_start`, `a_end`, `b_start`, `b_end` | Per-category A, B, change (B minus A) |
| `cash_flow` | `start`, `end` | In, out, net, spending, savings transfers, trading flows |
| `list_recurring_charges` | none | Bills and subscriptions, flags, recurring income |
| `forecast_month_end` | none | Projected month-end balance, lowest point, dips below buffer |
| `sync_status` | none | Connection state, last sync, recent runs, request budget (never starts a sync) |
| `safe_to_spend` | none | Checking minus bills before next income, buffer and unmet savings |
| `can_afford` | `amount` (dollars), `date?` | Yes/no with the reason |
| `save_plan` | none | Latest suggestion, weekly roll-up, goal pace |
| `budgets_status` | none | Limit, spent, percent, pace per budget |
| `savings_goal` | none | The goal and its pace |
| `get_digest_data` | `date?` | Everything for the morning digest |
| `list_categories` | none | Names, kinds, whether budgeted |
| `list_rules` | `include_defaults?` | Your rules (built-ins hidden by default) |

Digest write (scope `finance:read`, on unless `MCP_DIGEST_ENABLED=0`). It only appends one markdown note for a day and
sends the owner a push, so it is allowed with read scope. `readOnlyHint: false`, `destructiveHint: false`.

| Tool | Inputs | Effect |
| --- | --- | --- |
| `publish_digest` | `markdown` (max 4000 chars), `date?` (today, up to 7 days back) | Stores the day's digest as source `claude`, pushes it. Replaces the same day's earlier one |

Write (registered only when `MCP_WRITE_ENABLED` is `1`/`true` AND the caller has `finance:write`; never destructive):

| Tool | Inputs | Effect |
| --- | --- | --- |
| `recategorize_transaction` | `transaction_id`, `category` | Sets the category by hand (source `manual`, sync never overrides) |
| `create_rule` | `pattern`, `category`, `field?`, `match_type?`, `direction?` (default out), `amount_min?`, `amount_max?`, `apply_now` (default true) | Adds a rule at priority 100, returns how many transactions matched. Same rule twice returns the existing one. Regex: max 100 chars, no backreferences, lookaround, nested repeats, or repeated alternation |
| `set_budget` | `category`, `monthly_limit` (dollars) | Upserts the monthly limit of an expense category |
