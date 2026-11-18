// Usage: npm run create-owner -- --email you@example.com --password "at least 12 chars"
//        echo "$PASSWORD" | npm run create-owner -- --email you@example.com --password-stdin   (non-interactive, no password in argv)
//        npm run create-owner -- --reset-password   (changes the password of the existing owner)
//        npm run create-owner -- --reset-password --disable-2fa   (also turns 2FA off: lockout recovery over fly ssh)
//        npm run create-owner -- --disable-2fa   (turns 2FA off, password unchanged)
// Missing values are asked for on the terminal. Fails if an owner already exists unless --reset-password.
import readline from "node:readline";
import { eq } from "drizzle-orm";
import { createOwner } from "../src/lib/auth/owner";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../src/lib/auth/password";
import { disableTotp } from "../src/lib/auth/totp";
import { dbPath, openDb, schema } from "../src/lib/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Print the prompt, but not what is typed.
      const w = rl as unknown as { _writeToOutput: (s: string) => void };
      w._writeToOutput = (s: string) => {
        if (s.includes(question)) process.stdout.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const reset = process.argv.includes("--reset-password");
  const disable2fa = process.argv.includes("--disable-2fa");
  const db = openDb(dbPath());
  const existing = db.select().from(schema.users).get();

  // 2FA lockout recovery without touching the password.
  if (disable2fa && !reset) {
    if (!existing) {
      console.error("No owner exists yet.");
      process.exit(1);
    }
    disableTotp(db, existing.id);
    db.delete(schema.sessions).where(eq(schema.sessions.userId, existing.id)).run();
    db.delete(schema.pendingLogins).where(eq(schema.pendingLogins.userId, existing.id)).run();
    console.log(`2FA turned off for ${existing.email}. All sessions signed out.`);
    db.$client.close();
    return;
  }

  if (existing && !reset) {
    console.error(`An owner already exists (${existing.email}). Use --reset-password to change the password.`);
    process.exit(1);
  }
  if (!existing && reset) {
    console.error("No owner exists yet. Run without --reset-password.");
    process.exit(1);
  }

  const email = (arg("email") ?? (existing ? existing.email : await ask("Email: "))).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("That does not look like an email address.");
    process.exit(1);
  }
  const password = process.argv.includes("--password-stdin") ? await readStdin() : (arg("password") ?? (await ask("Password (min 12 chars): ", true)));
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }

  if (existing) {
    const passwordHash = await hashPassword(password);
    db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, existing.id)).run();
    db.delete(schema.sessions).where(eq(schema.sessions.userId, existing.id)).run();
    db.delete(schema.pendingLogins).where(eq(schema.pendingLogins.userId, existing.id)).run();
    if (disable2fa) disableTotp(db, existing.id);
    console.log(`Password reset for ${existing.email}. All sessions signed out.${disable2fa ? " 2FA turned off." : ""}`);
  } else {
    await createOwner(db, email, password);
    console.log(`Owner created: ${email}`);
  }
  db.$client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
