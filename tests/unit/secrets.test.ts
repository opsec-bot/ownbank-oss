import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSecrets, secretsFilePath } from "@/lib/secrets";
import { isValidTimezone, resolveTimezone, zoneLabel } from "@/lib/timezone";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ownbank-secrets-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const envFor = (extra: Record<string, string> = {}): Record<string, string | undefined> => ({ DATABASE_PATH: path.join(dir, "ownbank.db"), ...extra });

describe("ensureSecrets", () => {
  it("generates once and reuses the file on the second load", () => {
    const first = envFor();
    const r1 = ensureSecrets(first);
    expect(r1.sources).toEqual({ TOKEN_ENC_KEY: "generated", SYNC_SECRET: "generated", MCP_TOKEN: "generated", VAPID: "generated" });
    expect(Buffer.from(first.TOKEN_ENC_KEY!, "base64")).toHaveLength(32);
    expect(first.VAPID_PUBLIC_KEY).toBeTruthy();
    expect(first.VAPID_SUBJECT).toBe("mailto:admin@localhost");
    const file = secretsFilePath(first.DATABASE_PATH)!;
    expect(file).toBe(path.join(dir, "secrets.json"));
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    const second = envFor();
    const r2 = ensureSecrets(second);
    expect(r2.sources).toEqual({ TOKEN_ENC_KEY: "file", SYNC_SECRET: "file", MCP_TOKEN: "file", VAPID: "file" });
    expect(second.TOKEN_ENC_KEY).toBe(first.TOKEN_ENC_KEY);
    expect(second.MCP_TOKEN).toBe(first.MCP_TOKEN);
    expect(second.VAPID_PRIVATE_KEY).toBe(first.VAPID_PRIVATE_KEY);
  });

  it("lets env win and does not write a file when everything is set", () => {
    const key = Buffer.alloc(32, 9).toString("base64");
    const env = envFor({ TOKEN_ENC_KEY: key, SYNC_SECRET: "s", MCP_TOKEN: "m", VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:me@example.com" });
    const r = ensureSecrets(env);
    expect(Object.values(r.sources)).toEqual(["env", "env", "env", "env"]);
    expect(env.TOKEN_ENC_KEY).toBe(key);
    expect(env.VAPID_SUBJECT).toBe("mailto:me@example.com");
    expect(fs.existsSync(path.join(dir, "secrets.json"))).toBe(false);
  });

  it("fills only what env lacks", () => {
    const env = envFor({ MCP_TOKEN: "mine" });
    const r = ensureSecrets(env);
    expect(r.sources.MCP_TOKEN).toBe("env");
    expect(r.sources.TOKEN_ENC_KEY).toBe("generated");
    expect(env.MCP_TOKEN).toBe("mine");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "secrets.json"), "utf8")).MCP_TOKEN).toBeUndefined();
  });

  it("refuses to replace a corrupt file", () => {
    fs.writeFileSync(path.join(dir, "secrets.json"), "{nope");
    expect(() => ensureSecrets(envFor())).toThrow(/not valid JSON/);
  });

  it("skips the file for an in-memory database", () => {
    const env: Record<string, string | undefined> = { DATABASE_PATH: ":memory:" };
    ensureSecrets(env);
    expect(env.TOKEN_ENC_KEY).toBeTruthy();
  });
});

describe("timezone", () => {
  it("defaults, validates and labels", () => {
    expect(resolveTimezone("")).toBe("America/Chicago");
    expect(resolveTimezone("America/New_York")).toBe("America/New_York");
    expect(isValidTimezone("Nope/Nowhere")).toBe(false);
    expect(zoneLabel("America/New_York")).toBe("ET");
  });
});
