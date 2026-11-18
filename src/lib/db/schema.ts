import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Money is integer cents. Negative = money out. Timestamps are unix ms integers, dates are YYYY-MM-DD text.

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  // TOTP 2FA. Secret is encrypted (crypto.ts). Enabled once totp_enabled_at is set; until then it is a pending setup.
  totpSecretEnc: text("totp_secret_enc"),
  totpEnabledAt: integer("totp_enabled_at"),
  totpLastStep: integer("totp_last_step"), // last accepted 30 s step (replay protection)
});

export const recoveryCodes = sqliteTable(
  "recovery_codes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(), // SHA-256 of the normalized code
    usedAt: integer("used_at"),
  },
  (t) => [index("recovery_codes_user").on(t.userId)],
);

// Password was right, the 2FA code is still owed. The cookie holds a random token, only its hash is stored.
export const pendingLogins = sqliteTable("pending_logins", {
  idHash: text("id_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  next: text("next"), // same-site path to return to after login
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
  userAgent: text("user_agent"),
});

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull(), // "ip:<addr>" or "email:<addr>"
    at: integer("at").notNull(),
  },
  (t) => [index("login_attempts_key_at").on(t.key, t.at)],
);

export const connections = sqliteTable("connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull().default("simplefin"),
  providerConnectionId: text("provider_connection_id").notNull().unique(),
  institutionName: text("institution_name").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(), // encrypted provider access URL/token
  status: text("status", { enum: ["active", "broken"] })
    .notNull()
    .default("active"),
  lastSyncedAt: integer("last_synced_at"),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(), // provider account id
  connectionId: integer("connection_id")
    .notNull()
    .references(() => connections.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type"),
  subtype: text("subtype"),
  lastFour: text("last_four"),
  currency: text("currency").notNull().default("USD"),
  balanceAvailableCents: integer("balance_available_cents"),
  balanceLedgerCents: integer("balance_ledger_cents"),
  balanceUpdatedAt: integer("balance_updated_at"),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
});

export const balanceSnapshots = sqliteTable(
  "balance_snapshots",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    availableCents: integer("available_cents"),
    ledgerCents: integer("ledger_cents"),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.day] })],
);

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  kind: text("kind", { enum: ["expense", "income", "transfer"] }).notNull(),
  color: text("color").notNull(),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(), // provider transaction id
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    counterparty: text("counterparty"),
    merchantKey: text("merchant_key"),
    providerCategory: text("provider_category"),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    categorySource: text("category_source", { enum: ["provider", "rule", "manual"] }),
    status: text("status", { enum: ["pending", "posted"] })
      .notNull()
      .default("posted"),
    runningBalanceCents: integer("running_balance_cents"),
    firstSeenAt: integer("first_seen_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("transactions_date").on(t.date),
    index("transactions_account_date").on(t.accountId, t.date),
    index("transactions_category_date").on(t.categoryId, t.date),
  ],
);

export const rules = sqliteTable("rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  field: text("field", { enum: ["description", "counterparty", "any"] }).notNull(),
  matchType: text("match_type", { enum: ["contains", "equals", "regex"] }).notNull(),
  pattern: text("pattern").notNull(),
  amountMinCents: integer("amount_min_cents"),
  amountMaxCents: integer("amount_max_cents"),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  priority: integer("priority").notNull().default(0),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  // Which sign the rule applies to: out = money leaving (amount < 0), in = money arriving, any = both.
  direction: text("direction", { enum: ["out", "in", "any"] }).notNull().default("any"),
});

export const recurringCharges = sqliteTable("recurring_charges", {
  merchantKey: text("merchant_key").primaryKey(),
  displayName: text("display_name").notNull(),
  cadence: text("cadence", { enum: ["weekly", "biweekly", "monthly", "yearly"] }).notNull(),
  avgAmountCents: integer("avg_amount_cents").notNull(),
  lastDate: text("last_date").notNull(),
  nextExpected: text("next_expected"),
  occurrences: integer("occurrences").notNull(),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  variableAmount: integer("variable_amount", { mode: "boolean" }).notNull().default(false), // usage billed, shows "about"
  ignored: integer("ignored", { mode: "boolean" }).notNull().default(false), // user said "not a bill"
  manual: integer("manual", { mode: "boolean" }).notNull().default(false), // user-added, never rebuilt away
});

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  trigger: text("trigger", { enum: ["cron", "open", "webhook", "manual"] }).notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  ok: integer("ok", { mode: "boolean" }),
  stats: text("stats"), // json
  error: text("error"),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(), // always 1
  largeTxThresholdCents: integer("large_tx_threshold_cents").notNull().default(20000),
  pushLargeTx: integer("push_large_tx", { mode: "boolean" }).notNull().default(true),
  savePercent: integer("save_percent").notNull().default(20),
  bufferCents: integer("buffer_cents").notNull().default(5000),
  // Per-kind push toggles (large_tx uses pushLargeTx above). All on by default.
  pushDigest: integer("push_digest", { mode: "boolean" }).notNull().default(true),
  pushIncomeSave: integer("push_income_save", { mode: "boolean" }).notNull().default(true),
  pushLowBalance: integer("push_low_balance", { mode: "boolean" }).notNull().default(true),
  pushDisconnect: integer("push_disconnect", { mode: "boolean" }).notNull().default(true),
  pushBudgetPace: integer("push_budget_pace", { mode: "boolean" }).notNull().default(true),
  pushGoal: integer("push_goal", { mode: "boolean" }).notNull().default(true),
});

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: integer("created_at").notNull(),
  userAgent: text("user_agent"),
});

// Every push the app decided to send. dedupe_key is unique so the same alert never goes out twice.
// delivered: 0 = queued (quiet hours), 1 = sent to at least one device, 2 = nowhere to send (no devices / all failed).
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url").notNull().default("/dashboard"),
    tag: text("tag"),
    dedupeKey: text("dedupe_key").unique(),
    createdAt: integer("created_at").notNull(),
    delivered: integer("delivered").notNull().default(0),
  },
  (t) => [index("notifications_created").on(t.createdAt)],
);

// Monthly spending limit per expense category.
export const budgets = sqliteTable("budgets", {
  categoryId: integer("category_id")
    .primaryKey()
    .references(() => categories.id, { onDelete: "cascade" }),
  monthlyLimitCents: integer("monthly_limit_cents").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// One savings goal (id is always 1). Progress counts savings wallets only, never trading wallets.
export const savingsGoal = sqliteTable("savings_goal", {
  id: integer("id").primaryKey(), // always 1
  name: text("name").notNull(),
  targetCents: integer("target_cents").notNull(),
  targetDate: text("target_date"),
  counts: text("counts", { enum: ["stable", "all_savings"] }).notNull().default("stable"),
  createdAt: integer("created_at").notNull(),
});

export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: integer("received_at").notNull(),
});

export const oauthClients = sqliteTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientName: text("client_name"),
  redirectUris: text("redirect_uris").notNull(), // json
  createdAt: integer("created_at").notNull(),
});

export const oauthCodes = sqliteTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scope: text("scope"),
  resource: text("resource"), // RFC 8707 resource the client asked for, checked again at the token endpoint
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
});

export const oauthTokens = sqliteTable("oauth_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.clientId, { onDelete: "cascade" }),
  accessHash: text("access_hash").notNull().unique(),
  refreshHash: text("refresh_hash").notNull().unique(),
  accessExpiresAt: integer("access_expires_at").notNull(),
  refreshExpiresAt: integer("refresh_expires_at").notNull(),
  scope: text("scope").notNull().default("finance:read"),
  revokedAt: integer("revoked_at"),
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull(),
});

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

// Solana wallets tracked for net worth only (balance, no transactions). USD values are cents.
export const cryptoWallets = sqliteTable("crypto_wallets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chain: text("chain").notNull().default("solana"),
  address: text("address").notNull().unique(),
  label: text("label").notNull().default(""),
  solLamports: integer("sol_lamports").notNull().default(0),
  solUsdCents: integer("sol_usd_cents").notNull().default(0),
  tokensUsdCents: integer("tokens_usd_cents").notNull().default(0),
  totalUsdCents: integer("total_usd_cents").notNull().default(0),
  unpricedCount: integer("unpriced_count").notNull().default(0),
  stableUsdCents: integer("stable_usd_cents").notNull().default(0), // USDC/USDT/PYUSD by mint
  volatileUsdCents: integer("volatile_usd_cents").notNull().default(0), // SOL + everything else priced
  topHoldings: text("top_holdings").notNull().default("[]"), // json [{symbol, usdCents}]
  role: text("role", { enum: ["savings", "trading"] }).notNull().default("savings"),
  lastSignature: text("last_signature"), // cursor for trading-wallet flow scan
  updatedAt: integer("updated_at"),
  lastError: text("last_error"),
});

// One row per day, written after sync. total_cents excludes trading wallets (treated as already spent).
export const netWorthSnapshots = sqliteTable("net_worth_snapshots", {
  day: text("day").primaryKey(),
  bankCents: integer("bank_cents").notNull(),
  cryptoStableCents: integer("crypto_stable_cents").notNull(),
  cryptoVolatileCents: integer("crypto_volatile_cents").notNull(),
  cryptoTradingCents: integer("crypto_trading_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
});

// Latest digest per day. Claude posts source 'claude'; the app writes 'auto' fallbacks.
export const digests = sqliteTable("digests", {
  day: text("day").primaryKey(),
  source: text("source", { enum: ["claude", "auto"] }).notNull(),
  bodyMd: text("body_md").notNull(),
  createdAt: integer("created_at").notNull(),
});

// Small key/value store for one-time data tasks.
export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const saveSuggestions = sqliteTable("save_suggestions", {
  incomeTxId: text("income_tx_id").primaryKey(),
  suggestedCents: integer("suggested_cents").notNull(),
  reason: text("reason").notNull(),
  createdAt: integer("created_at").notNull(),
  fulfilledCents: integer("fulfilled_cents").notNull().default(0),
  fulfilledAt: integer("fulfilled_at"),
});

// Transfers between the owner's savings wallets and trading wallets (on-chain).
export const walletFlows = sqliteTable(
  "wallet_flows",
  {
    signature: text("signature").primaryKey(),
    day: text("day").notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    mint: text("mint").notNull(), // "SOL" for native transfers
    symbol: text("symbol").notNull(),
    amountRaw: text("amount_raw").notNull(),
    usdCents: integer("usd_cents").notNull(),
    kind: text("kind", { enum: ["trading_funded", "trading_realized"] }).notNull(),
  },
  (t) => [index("wallet_flows_day").on(t.day)],
);
