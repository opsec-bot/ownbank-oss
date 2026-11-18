CREATE TABLE `budgets` (
	`category_id` integer PRIMARY KEY NOT NULL,
	`monthly_limit_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text DEFAULT '/dashboard' NOT NULL,
	`tag` text,
	`dedupe_key` text,
	`created_at` integer NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_key_unique` ON `notifications` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_created` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE TABLE `savings_goal` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target_cents` integer NOT NULL,
	`target_date` text,
	`counts` text DEFAULT 'stable' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD `user_agent` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `push_digest` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `push_income_save` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `push_low_balance` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `push_disconnect` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `push_budget_pace` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `push_goal` integer DEFAULT true NOT NULL;