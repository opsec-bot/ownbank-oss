CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text,
	`subtype` text,
	`last_four` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`balance_available_cents` integer,
	`balance_ledger_cents` integer,
	`balance_updated_at` integer,
	`hidden` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`account_id` text NOT NULL,
	`day` text NOT NULL,
	`available_cents` integer,
	`ledger_cents` integer,
	PRIMARY KEY(`account_id`, `day`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`color` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text DEFAULT 'simplefin' NOT NULL,
	`provider_connection_id` text NOT NULL,
	`institution_name` text NOT NULL,
	`access_token_enc` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_provider_connection_id_unique` ON `connections` (`provider_connection_id`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_key_at` ON `login_attempts` (`key`,`at`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`client_name` text,
	`redirect_uris` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`scope` text,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`access_hash` text NOT NULL,
	`refresh_hash` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`refresh_expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_tokens_access_hash_unique` ON `oauth_tokens` (`access_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_tokens_refresh_hash_unique` ON `oauth_tokens` (`refresh_hash`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key`, `window_start`)
);
--> statement-breakpoint
CREATE TABLE `recurring_charges` (
	`merchant_key` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`cadence` text NOT NULL,
	`avg_amount_cents` integer NOT NULL,
	`last_date` text NOT NULL,
	`next_expected` text,
	`occurrences` integer NOT NULL,
	`category_id` integer,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`field` text NOT NULL,
	`match_type` text NOT NULL,
	`pattern` text NOT NULL,
	`amount_min_cents` integer,
	`amount_max_cents` integer,
	`category_id` integer NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`large_tx_threshold_cents` integer DEFAULT 20000 NOT NULL,
	`push_large_tx` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`ok` integer,
	`stats` text,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`description` text NOT NULL,
	`counterparty` text,
	`merchant_key` text,
	`provider_category` text,
	`category_id` integer,
	`category_source` text,
	`status` text DEFAULT 'posted' NOT NULL,
	`running_balance_cents` integer,
	`first_seen_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `transactions_date` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_account_date` ON `transactions` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_category_date` ON `transactions` (`category_id`,`date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`received_at` integer NOT NULL
);
