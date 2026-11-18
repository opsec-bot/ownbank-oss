ALTER TABLE `rules` ADD `direction` text DEFAULT 'any' NOT NULL;
--> statement-breakpoint
-- Refund category for small inflows; default rules are replaced with the sign-aware list below.
INSERT INTO `categories` (`name`, `kind`, `color`) VALUES ('Refund', 'income', '#7fa88f');
--> statement-breakpoint
DELETE FROM `rules` WHERE `is_default` = 1;
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'coinbase', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'kraken', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'moonpay', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'phantom', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'binance', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'gemini', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'robinhood crypto', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'regex', 'cash app\W{0,3}bitcoin', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'zelle', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Personal transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'venmo', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Personal transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'cash app', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Personal transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'paypal', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Personal transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'dailypay', `id`, -100, 1, 1794990000000, 1, 'in' FROM `categories` WHERE `name` = 'Income';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'daily pay', `id`, -100, 1, 1794990000000, 1, 'in' FROM `categories` WHERE `name` = 'Income';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'payroll', `id`, -100, 1, 1794990000000, 1, 'in' FROM `categories` WHERE `name` = 'Income';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'direct dep', `id`, -100, 1, 1794990000000, 1, 'in' FROM `categories` WHERE `name` = 'Income';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'resale pay', `id`, -100, 1, 1794990000000, 1, 'in' FROM `categories` WHERE `name` = 'Income';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'online banking transfer', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'mobile banking transfer', `id`, -100, 1, 1794990000000, 1, 'any' FROM `categories` WHERE `name` = 'Transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'regex', '\btransfer from (chk|checking|sav|savings)\b', `id`, -100, 1, 1794990000000, 1, 'in' FROM `categories` WHERE `name` = 'Transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'regex', '\bnsf\b', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Fees';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'regex', '\boverdraft\b', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Fees';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'monthly maintenance', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Fees';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'service fee', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Fees';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'instant transfer fee', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Fees';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'atm withdrawal', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Cash & ATM';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'netflix', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'spotify', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'apple.com/bill', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'amazon prime', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'hulu', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'disney', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'openai', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'anthropic', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'claude', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'chatgpt', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'github', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'discord', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'xbox', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'playstation', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'youtube', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'google', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'regex', '\bsteam(games|powered|\b)', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'walmart grocery', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'kroger', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'aldi', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'costco', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'tom thumb', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'whole foods', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'trader joe', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'regex', '\bheb\b', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'mcdonald', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'chick-fil-a', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'starbucks', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'taco bell', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'wendy', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'chipotle', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'doordash', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'uber eats', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'grubhub', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'whataburger', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'raising cane', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'regex', '\bsonic\b', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'lyft', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'exxon', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'chevron', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'quiktrip', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'racetrac', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', '7-eleven fuel', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'buc-ee', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'uber', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'regex', '\bshell\b', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'regex', '\bqt\b', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'amazon', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Shopping';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'target', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Shopping';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'best buy', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Shopping';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) SELECT 'any', 'contains', 'walmart', `id`, -100, 1, 1794990000000, 1, 'out' FROM `categories` WHERE `name` = 'Shopping';

--> statement-breakpoint
UPDATE `app_state` SET `value` = '1' WHERE `key` = 'needs_recategorize';
