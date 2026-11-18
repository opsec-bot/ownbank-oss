import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, parseKey } from "@/lib/crypto";

describe("crypto", () => {
  it("round-trips with the env key", () => {
    const ct = encrypt("secret-access-token");
    expect(ct.startsWith("v1:")).toBe(true);
    expect(ct.split(":")).toHaveLength(4);
    expect(decrypt(ct)).toBe("secret-access-token");
  });

  it("uses a fresh iv each time", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("round-trips unicode and empty strings", () => {
    expect(decrypt(encrypt("héllo ✓"))).toBe("héllo ✓");
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("detects tampering in ciphertext, tag, and iv", () => {
    const [v, iv, tag, ct] = encrypt("do not touch").split(":");
    const flip = (b64: string) => {
      const b = Buffer.from(b64, "base64");
      b[0] ^= 1;
      return b.toString("base64");
    };
    expect(() => decrypt([v, iv, tag, flip(ct)].join(":"))).toThrow();
    expect(() => decrypt([v, iv, flip(tag), ct].join(":"))).toThrow();
    expect(() => decrypt([v, flip(iv), tag, ct].join(":"))).toThrow();
  });

  it("fails with the wrong key", () => {
    const ct = encrypt("x", randomBytes(32));
    expect(() => decrypt(ct, randomBytes(32))).toThrow();
  });

  it("rejects unknown formats", () => {
    expect(() => decrypt("v2:a:b:c")).toThrow();
    expect(() => decrypt("garbage")).toThrow();
  });

  it("validates key length", () => {
    expect(() => parseKey(undefined)).toThrow();
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(parseKey(randomBytes(32).toString("base64"))).toHaveLength(32);
  });
});
