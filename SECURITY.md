# Security

## Reporting a problem

Please use GitHub private vulnerability reporting: open the Security tab of this repository and choose "Report a vulnerability". Do not open a public issue for security problems. You should get a reply within a few days.

## Threat model

ownbank holds one person's bank history on a server that person controls.

What it defends against:

- Strangers on the internet. There is no signup. The only way to create the owner is the one-time setup code printed in the server log, and it stops working once an owner exists.
- Password guessing. Argon2id hashing, lockout after 5 failures per 15 minutes per address and per account, optional TOTP two-factor.
- A stolen database file. The bank access token is encrypted with AES-256-GCM. Sessions, OAuth tokens and recovery codes are stored as hashes.
- Bank abuse. The SimpleFIN feed is read-only. ownbank cannot move money.
- Claude overreach. MCP is read-only by default. Write tools need `MCP_WRITE_ENABLED=true`. Output is masked: account numbers keep only the last four digits.

What it does not defend against:

- Someone with shell access to the server. They can read `secrets.json` and the database.
- A compromised browser or phone that is already signed in.
- Running it on plain http across the internet. Put it behind HTTPS (see INSTALL.md).

Keep `data/secrets.json` private and include it in backups.
