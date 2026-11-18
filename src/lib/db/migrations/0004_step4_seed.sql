-- Step 4 seed: new categories, default payee rules, split backfill, one-time re-categorize flag.
INSERT INTO `categories` (`name`, `kind`, `color`) VALUES
  ('Savings transfer', 'transfer', '#7fb5ad'),
  ('Fees', 'expense', '#c98a7a'),
  ('Cash & ATM', 'expense', '#b5a37a'),
  ('Personal transfer', 'transfer', '#9a9fa8'),
  ('Memecoin trading', 'expense', '#c27ad0'),
  ('Trading realized', 'income', '#6fc7a0');
--> statement-breakpoint
UPDATE `crypto_wallets` SET `volatile_usd_cents` = `total_usd_cents` WHERE `volatile_usd_cents` = 0;
--> statement-breakpoint
INSERT INTO `app_state` (`key`, `value`) VALUES ('needs_recategorize', '1');
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'coinbase', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'kraken', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'moonpay', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'phantom', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'binance', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'gemini', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'robinhood crypto', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'regex', 'cash app\W{0,3}bitcoin', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Savings transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'zelle', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Personal transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'venmo', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Personal transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'cash app', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Personal transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'paypal', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Personal transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'online banking transfer', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'mobile banking transfer', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Transfer';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'direct deposit', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Income';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'payroll', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Income';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'overdraft', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Fees';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'monthly maintenance fee', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Fees';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'nsf', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Fees';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'atm withdrawal', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Cash & ATM';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'netflix', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'spotify', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'apple.com/bill', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'amazon prime', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'hulu', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'disney', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'openai', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'anthropic', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'claude', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'chatgpt', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'github', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'discord', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'xbox', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'playstation', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'youtube', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'google', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'regex', '\bsteam(games|powered|\b)', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Subscriptions';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'walmart grocery', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'kroger', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'aldi', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'costco', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'tom thumb', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'whole foods', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'trader joe', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'regex', '\bheb\b', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Groceries';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'mcdonald', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'chick-fil-a', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'starbucks', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'taco bell', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'wendy', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'chipotle', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'doordash', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'uber eats', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'grubhub', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'whataburger', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'raising cane', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'regex', '\bsonic\b', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Dining';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'lyft', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'exxon', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'chevron', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'quiktrip', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'racetrac', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', '7-eleven fuel', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'buc-ee', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'uber', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'regex', '\bshell\b', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'regex', '\bqt\b', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Transport';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'amazon', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Shopping';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'target', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Shopping';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'best buy', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Shopping';
--> statement-breakpoint
INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`) SELECT 'any', 'contains', 'walmart', `id`, -100, 1, 1794990000000, 1 FROM `categories` WHERE `name` = 'Shopping';
