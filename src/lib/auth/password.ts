import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 defaults to Argon2id. Parameters follow the OWASP minimum (19 MiB, 2 passes, 1 lane).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// Verified against when the email does not exist, so unknown and known emails take the same time.
let dummy: Promise<string> | undefined;
function dummyHash(): Promise<string> {
  dummy ??= hashPassword("ownbank-dummy-password-" + Math.random());
  return dummy;
}

export async function verifyDummy(password: string): Promise<false> {
  await verifyPassword(await dummyHash(), password);
  return false;
}
