CREATE TABLE `pending_logins` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`next` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recovery_codes_user` ON `recovery_codes` (`user_id`);--> statement-breakpoint
ALTER TABLE `oauth_codes` ADD `resource` text;--> statement-breakpoint
ALTER TABLE `oauth_tokens` ADD `scope` text DEFAULT 'finance:read' NOT NULL;--> statement-breakpoint
ALTER TABLE `oauth_tokens` ADD `last_used_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_secret_enc` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_enabled_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_last_step` integer;