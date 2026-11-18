CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `digests` (
	`day` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`body_md` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `net_worth_snapshots` (
	`day` text PRIMARY KEY NOT NULL,
	`bank_cents` integer NOT NULL,
	`crypto_stable_cents` integer NOT NULL,
	`crypto_volatile_cents` integer NOT NULL,
	`crypto_trading_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `save_suggestions` (
	`income_tx_id` text PRIMARY KEY NOT NULL,
	`suggested_cents` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`fulfilled_cents` integer DEFAULT 0 NOT NULL,
	`fulfilled_at` integer
);
--> statement-breakpoint
CREATE TABLE `wallet_flows` (
	`signature` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`from_address` text NOT NULL,
	`to_address` text NOT NULL,
	`mint` text NOT NULL,
	`symbol` text NOT NULL,
	`amount_raw` text NOT NULL,
	`usd_cents` integer NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wallet_flows_day` ON `wallet_flows` (`day`);--> statement-breakpoint
ALTER TABLE `crypto_wallets` ADD `stable_usd_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `crypto_wallets` ADD `volatile_usd_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `crypto_wallets` ADD `top_holdings` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `crypto_wallets` ADD `role` text DEFAULT 'savings' NOT NULL;--> statement-breakpoint
ALTER TABLE `crypto_wallets` ADD `last_signature` text;--> statement-breakpoint
ALTER TABLE `recurring_charges` ADD `ignored` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring_charges` ADD `manual` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `rules` ADD `is_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `save_percent` integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `buffer_cents` integer DEFAULT 5000 NOT NULL;