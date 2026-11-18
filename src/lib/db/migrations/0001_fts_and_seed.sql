-- Full-text search over transactions (external content table, kept in sync by triggers).
CREATE VIRTUAL TABLE `transactions_fts` USING fts5(
  description,
  counterparty,
  content='transactions',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `transactions_fts_ai` AFTER INSERT ON `transactions` BEGIN
  INSERT INTO `transactions_fts`(rowid, description, counterparty)
  VALUES (new.rowid, new.description, COALESCE(new.counterparty, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `transactions_fts_ad` AFTER DELETE ON `transactions` BEGIN
  INSERT INTO `transactions_fts`(`transactions_fts`, rowid, description, counterparty)
  VALUES ('delete', old.rowid, old.description, COALESCE(old.counterparty, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `transactions_fts_au` AFTER UPDATE ON `transactions` BEGIN
  INSERT INTO `transactions_fts`(`transactions_fts`, rowid, description, counterparty)
  VALUES ('delete', old.rowid, old.description, COALESCE(old.counterparty, ''));
  INSERT INTO `transactions_fts`(rowid, description, counterparty)
  VALUES (new.rowid, new.description, COALESCE(new.counterparty, ''));
END;
--> statement-breakpoint
-- Default categories.
INSERT INTO `categories` (`name`, `kind`, `color`) VALUES
  ('Groceries', 'expense', '#6fa86f'),
  ('Dining', 'expense', '#d98f5c'),
  ('Transport', 'expense', '#5c9bd9'),
  ('Shopping', 'expense', '#b07fd0'),
  ('Bills & Utilities', 'expense', '#d9c25c'),
  ('Subscriptions', 'expense', '#d96f8f'),
  ('Entertainment', 'expense', '#5cc4c4'),
  ('Health', 'expense', '#8fd96f'),
  ('Travel', 'expense', '#6f7fd9'),
  ('Income', 'income', '#4fbf8f'),
  ('Transfer', 'transfer', '#8a8f98'),
  ('Other', 'expense', '#a89f91');
--> statement-breakpoint
-- The single settings row.
INSERT INTO `settings` (`id`, `large_tx_threshold_cents`, `push_large_tx`) VALUES (1, 20000, 1);
