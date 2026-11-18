# Install ownbank

This file is written for an AI coding agent and for humans. Follow the steps in order. Run the commands exactly. If a step says "Ask the human", stop and ask. Never invent values.

## Ask the human for

1. A SimpleFIN setup token. They get it at https://beta-bridge.simplefin.org after linking their bank (about $15 a year). Never make one up and never try to log in to their bank. The token is optional at install time: the app works without it and the human can paste it later in Settings > Bank.
2. An email and a password for the owner account. The password must be at least 12 characters. Do not pick one for them.
3. The public address (domain) if the app will not run only on this machine. If they have none, use http://localhost:3000.

## A) Docker (Linux, macOS, Windows)

Needs Docker with the compose plugin and git.

1. Get the code.

```sh
git clone https://github.com/opsec-bot/ownbank-oss.git
cd ownbank-oss
```

2. Create the settings file and set the public address.

```sh
cp .env.example .env
```

Edit `.env` and set `APP_URL` to the address people will type in the browser (for example `https://bank.example.com`). Leave it as `http://localhost:3000` for a local-only install. Leave every other line empty. Secrets are generated on first start.

3. Build and start.

```sh
docker compose up -d --build
```

Expected: the build finishes and `docker compose ps` shows `ownbank` as `running` (then `healthy` after about 30 seconds). The first build takes a few minutes.

4. Read the setup code.

```sh
docker compose logs ownbank
```

Expected output contains a boxed line:

```text
ownbank setup code: ABCD-EFGH-JKLM  -  open http://localhost:3000/setup
```

5. Create the owner. Pick one way.

- Browser: open `<APP_URL>/setup`, enter the code, the email and the password.
- Command line (best for agents). Pipe the password in so it never appears in the process list:

```sh
printf '%s' "$OWNER_PASSWORD" | docker compose exec -T ownbank npm run create-owner -- --email "$OWNER_EMAIL" --password-stdin
```

Expected: `Owner created: <email>`.

6. Connect the bank. Ask the human for the SimpleFIN setup token, then have them open `<APP_URL>/settings/bank`, sign in, and paste it. The first sync runs right away.

7. Verify.

```sh
docker compose exec -T ownbank npm run doctor -- --json
```

Data lives in `./data` (database and `secrets.json`). Back up the whole folder. To update later: `git pull && docker compose up -d --build`.

## B) Fly.io

Needs the `fly` CLI and a logged-in Fly account (`fly auth login`). Pick an app name that is not taken and a region near the human (for example `ord`, `iad`, `lhr`).

1. Get the code and create the app without deploying. Replace `my-ownbank` and `ord`.

```sh
git clone https://github.com/opsec-bot/ownbank-oss.git
cd ownbank-oss
fly launch --no-deploy --copy-config --name my-ownbank --region ord
```

If it asks to tweak settings, answer no.

2. Create the data volume. The name must stay `ownbank_data`, it is referenced in `fly.toml`.

```sh
fly volumes create ownbank_data --size 1 --region ord
```

3. Set the public address.

```sh
fly secrets set APP_URL=https://my-ownbank.fly.dev
```

4. Deploy. Keep it at one machine: the database is one file on one volume.

```sh
fly deploy
fly scale count 1
```

5. Read the setup code.

```sh
fly logs --no-tail | grep "setup code"
```

Expected: `ownbank setup code: ABCD-EFGH-JKLM  -  open https://my-ownbank.fly.dev/setup`. If nothing shows, wait 20 seconds and run it again.

6. Create the owner in the browser at `/setup`, or from the command line:

```sh
printf '%s' "$OWNER_PASSWORD" | fly ssh console -C "npm run create-owner -- --email $OWNER_EMAIL --password-stdin"
```

7. Connect the bank at `<APP_URL>/settings/bank` (ask the human for the token), then verify:

```sh
fly ssh console -C "npm run doctor -- --json"
```

Optional backups: `fly storage create`, which sets `BUCKET_NAME` and the `AWS_*` secrets. The app then streams the database to the bucket with Litestream. `secrets.json` is not in the bucket, so keep a copy of it: `fly ssh sftp get /data/secrets.json`.

## C) Local development

Needs Node 22 or newer.

```sh
git clone https://github.com/opsec-bot/ownbank-oss.git
cd ownbank-oss
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The terminal prints the setup code. Data is created in `./data`. Run `npm run doctor` any time.

## HTTPS

If the app is reachable from outside your machine, put it behind HTTPS and set `APP_URL` to that address. Pick one.

Tailscale (private, only your devices):

```sh
tailscale serve --bg 3000
```

The address is `https://<machine>.<tailnet>.ts.net`.

Cloudflare Tunnel (public address, no open ports):

```sh
cloudflared tunnel --url http://localhost:3000
```

For a permanent hostname, create a named tunnel in the Cloudflare dashboard and point it at `http://localhost:3000`.

Caddy (your own domain on a server with ports 80 and 443 open). Put this in `Caddyfile`, then run `caddy run`:

```text
bank.example.com {
  reverse_proxy localhost:3000
}
```

After changing the address, update `APP_URL` in `.env` and run `docker compose up -d`.

## Verify

Run `npm run doctor -- --json` (see each section for the exact command). These must be true:

- `ok` is `true`
- `database` is `true`
- `owner` is `true`
- the check with id `app_url` has level `pass` when the app is not on localhost

`bankConnected` is `true` once the human has pasted the SimpleFIN token. A `false` there is fine at install time. Tell the human the next step is Settings > Bank.

## Troubleshooting

- No setup code in the log: an owner already exists. Sign in at `/login`.
- Lost the password: `npm run create-owner -- --reset-password` (inside the container with `docker compose exec`).
- Doctor says migrations are missing: restart the app, it applies them on start.
- Moved to a new machine: copy the whole `data` folder, including `secrets.json`.
