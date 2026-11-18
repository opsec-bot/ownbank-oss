// Dev only. Encrypts an EXISTING SimpleFIN access URL (read from a file) straight into the local database,
// for when the setup token was already claimed. The URL is never printed.
// Usage: npm run dev:connect -- "C:\path\to\access-url.txt"
import fs from "node:fs";
import { storeAccessUrl } from "../src/lib/bank/connect";
import { getDb } from "../src/lib/db";
import { ensureSecrets } from "../src/lib/secrets";

ensureSecrets(); // fill missing secrets from secrets.json next to the database

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run dev:connect -- "<path to a file containing the access URL>"');
  process.exit(1);
}
if (!process.env.TOKEN_ENC_KEY) {
  console.error("TOKEN_ENC_KEY is not set (put it in .env.local and run through the npm script).");
  process.exit(1);
}

const accessUrl = fs.readFileSync(file, "utf8").trim();
try {
  const u = new URL(accessUrl);
  if (!u.username || !u.password) throw new Error("no credentials");
} catch {
  console.error("The file does not contain a SimpleFIN access URL (https://user:pass@host/simplefin).");
  process.exit(1);
}

getDb(); // runs migrations
const id = storeAccessUrl(accessUrl, "SimpleFIN");
console.log(`Stored encrypted access URL on connection #${id}.`);
