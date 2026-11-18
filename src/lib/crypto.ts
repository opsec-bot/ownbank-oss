import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. Stored format: v1:<iv>:<tag>:<ciphertext>, each part base64.
// The key is passed in (or read from TOKEN_ENC_KEY) so tests can use their own.

function keyFromEnv(): Buffer {
  return parseKey(process.env.TOKEN_ENC_KEY);
}

export function parseKey(b64: string | undefined): Buffer {
  if (!b64) throw new Error("TOKEN_ENC_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes, base64");
  return key;
}

export function encrypt(plaintext: string, key: Buffer = keyFromEnv()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(payload: string, key: Buffer = keyFromEnv()): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unsupported ciphertext format");
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
