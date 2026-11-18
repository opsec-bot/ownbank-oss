// Prints a new VAPID keypair for Web Push. Paste the values into .env.local (dev) or `fly secrets set` (prod).
// Generate once and keep the pair: changing it later makes every existing phone subscription invalid.
import { generateVAPIDKeys } from "web-push";

const { publicKey, privateKey } = generateVAPIDKeys();
console.log("Paste these into .env.local, or: fly secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=...");
console.log("");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:you@example.com");
