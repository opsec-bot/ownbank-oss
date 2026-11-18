# solana

Solana wallet balances for net worth. Balance only: no transactions, no spend tracking.

- `balances.ts`: Helius DAS `getAssetsByOwner` (`HELIUS_RPC_URL`, a secret) with `showFungible` and `showNativeBalance`. SOL value from `nativeBalance.total_price`, tokens from `token_info.price_info.total_price` where `balance > 0`. Tokens with no price count in `unpriced_count` and add $0. Pages through 1000 items at a time.
- Wallets live in the `crypto_wallets` table, managed on Settings (add or remove an address and label). Nothing is seeded.
- Refreshed after every bank sync; a wallet failure is stored in `last_error` and never fails the bank sync.
- The RPC URL is never logged and never put in error text.
