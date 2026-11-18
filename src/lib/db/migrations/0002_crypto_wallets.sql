CREATE TABLE `crypto_wallets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chain` text DEFAULT 'solana' NOT NULL,
	`address` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`sol_lamports` integer DEFAULT 0 NOT NULL,
	`sol_usd_cents` integer DEFAULT 0 NOT NULL,
	`tokens_usd_cents` integer DEFAULT 0 NOT NULL,
	`total_usd_cents` integer DEFAULT 0 NOT NULL,
	`unpriced_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crypto_wallets_address_unique` ON `crypto_wallets` (`address`);