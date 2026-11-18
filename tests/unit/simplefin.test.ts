import { describe, expect, it } from "vitest";
import fixture from "../fixtures/simplefin-accounts.json";
import {
  SimpleFinError,
  decodeSetupToken,
  extractLastFour,
  guessAccountType,
  parseAccountsResponse,
  parseMoneyToCents,
  providerConnectionId,
  splitAccessUrl,
} from "@/lib/bank/simplefin";

describe("parseMoneyToCents", () => {
  it("parses exactly", () => {
    expect(parseMoneyToCents("68.58")).toBe(6858);
    expect(parseMoneyToCents("-12.34")).toBe(-1234);
    expect(parseMoneyToCents("12")).toBe(1200);
    expect(parseMoneyToCents("-0.5")).toBe(-50);
    expect(parseMoneyToCents("+3.00")).toBe(300);
    expect(parseMoneyToCents("0.00")).toBe(0);
    expect(Object.is(parseMoneyToCents("-0.00"), 0)).toBe(true);
  });
  it("avoids float bugs", () => {
    expect(parseMoneyToCents("1.15")).toBe(115);
    expect(parseMoneyToCents("19.99")).toBe(1999);
    expect(parseMoneyToCents("1234567890.07")).toBe(123456789007);
  });
  it("rounds extra decimals half away from zero", () => {
    expect(parseMoneyToCents("1.005")).toBe(101);
    expect(parseMoneyToCents("1.004")).toBe(100);
    expect(parseMoneyToCents("-1.005")).toBe(-101);
  });
  it("rejects junk", () => {
    expect(() => parseMoneyToCents("abc")).toThrow();
    expect(() => parseMoneyToCents("1e3")).toThrow();
    expect(() => parseMoneyToCents("")).toThrow();
  });
});

describe("extractLastFour", () => {
  it("reads parens and dashes, max 4 digits", () => {
    expect(extractLastFour("Fake Checking- 1234 (1234)")).toBe("1234");
    expect(extractLastFour("Savings - 0042")).toBe("0042");
    expect(extractLastFour("Card (x12345678)")).toBe("5678");
    expect(extractLastFour("Plain Account")).toBeNull();
  });
});

describe("account type guess", () => {
  it("flags cards as credit", () => {
    expect(guessAccountType("Fake Rewards Visa Card (9876)")).toBe("credit");
    expect(guessAccountType("Fake Checking")).toBe("depository");
  });
});

describe("setup token and access url", () => {
  it("decodes a base64 claim url", () => {
    const url = "https://bridge.example/simplefin/claim/abc123";
    expect(decodeSetupToken(Buffer.from(url).toString("base64"))).toBe(url);
    expect(() => decodeSetupToken("not a token !!")).toThrow(SimpleFinError);
  });
  it("splits credentials out of the url", () => {
    const { base, authHeader } = splitAccessUrl("https://us%40er:p%3Ass@bridge.example/simplefin");
    expect(base).toBe("https://bridge.example/simplefin");
    expect(authHeader).toBe("Basic " + Buffer.from("us@er:p:ss").toString("base64"));
  });
  it("connection id ignores the password", () => {
    const a = providerConnectionId("https://u:one@bridge.example/simplefin");
    const b = providerConnectionId("https://u:two@bridge.example/simplefin");
    expect(a).toBe(b);
    expect(a).not.toContain("one");
  });
});

describe("parseAccountsResponse", () => {
  it("parses the fixture", () => {
    const r = parseAccountsResponse(fixture);
    expect(r.accounts).toHaveLength(2);
    expect(r.connectionNames).toEqual(["Fake Test Bank"]);
    const a = r.accounts[0];
    expect(a.balanceCents).toBe(10050);
    expect(a.availableBalanceCents).toBe(9025);
    expect(a.orgName).toBe("Fake Test Bank");
    expect(a.transactions.map((t) => t.amountCents)).toEqual([-1234, -500, 250000]);
    expect(a.transactions[0].mcc).toBe("5411");
    expect(a.transactions[1].pending).toBe(true);
    expect(a.transactions[2].pending).toBe(false);
    expect(r.accounts[1].balanceCents).toBe(-25000);
    expect(r.accounts[1].availableBalanceCents).toBeNull();
  });
  it("treats errors as a broken connection", () => {
    expect(() => parseAccountsResponse({ errors: ["Authentication needed"], accounts: [] })).toThrow(/Authentication needed/);
    expect(() => parseAccountsResponse({ errors: [], errlist: [{ code: "gen.auth", msg: "Reauth" }], accounts: [] })).toThrow(/Reauth/);
  });
  it("rejects garbage", () => {
    expect(() => parseAccountsResponse(null)).toThrow(SimpleFinError);
    expect(() => parseAccountsResponse({ errors: [] })).toThrow(SimpleFinError);
  });
});
