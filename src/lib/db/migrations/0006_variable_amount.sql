ALTER TABLE `recurring_charges` ADD `variable_amount` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `app_state` SET `value` = '1' WHERE `key` = 'needs_recategorize';
