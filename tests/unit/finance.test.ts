import { describe, expect, it } from "vitest";
import { localDate, merchantKey } from "@/lib/bank/normalize";
import { categorize, mccToCategory, type RuleRow } from "@/lib/finance/categorize";
import { addCadence, detectRecurring, type RecurringInput } from "@/lib/finance/recurring";

describe("merchantKey", () => {
  it("strips digits, refs and store numbers", () => {
    expect(merchantKey("Fake Grocery #123", "x")).toBe("fake grocery");
    expect(merchantKey(null, "FAKE GROCERY #123 DALLAS TX")).toBe("fake grocery");
    expect(merchantKey(null, "AMZN Mktp US*2K4AB  Amzn.com/bill")).toBe("amzn mktp us amzncom bill");
    expect(merchantKey("  ", "Same   Spaces")).toBe("same spaces");
  });
  it("falls back when everything is digits", () => {
    expect(merchantKey(null, "12345 678")).toBe("12345 678");
  });
});

describe("localDate", () => {
  it("uses America/Chicago", () => {
    // 2025-11-18 03:00 UTC is still Nov 17 in Chicago.
    expect(localDate(Date.UTC(2025, 10, 18, 3, 0, 0) / 1000)).toBe("2025-11-17");
    expect(localDate(Date.UTC(2025, 10, 18, 18, 0, 0) / 1000)).toBe("2025-11-18");
  });
});

describe("mccToCategory", () => {
  it("maps common ranges", () => {
    expect(mccToCategory("5411")).toBe("Groceries");
    expect(mccToCategory("5812")).toBe("Dining");
    expect(mccToCategory("5814")).toBe("Dining");
    expect(mccToCategory("4111")).toBe("Transport");
    expect(mccToCategory("5541")).toBe("Transport");
    expect(mccToCategory("4900")).toBe("Bills & Utilities");
    expect(mccToCategory("5311")).toBe("Shopping");
    expect(mccToCategory("5999")).toBe("Shopping");
    expect(mccToCategory("7832")).toBe("Entertainment");
    expect(mccToCategory("8011")).toBe("Health");
    expect(mccToCategory("8099")).toBe("Health");
    expect(mccToCategory("3500")).toBe("Travel");
    expect(mccToCategory("4511")).toBe("Travel");
    expect(mccToCategory("7011")).toBe("Travel");
    expect(mccToCategory("5816")).toBe("Subscriptions");
  });
  it("returns null for unknown or empty", () => {
    expect(mccToCategory("0000")).toBeNull();
    expect(mccToCategory(null)).toBeNull();
    expect(mccToCategory("abc")).toBeNull();
  });
});

const ids = new Map([
  ["Groceries", 1],
  ["Income", 10],
  ["Other", 12],
  ["Custom", 99],
]);
const rule = (over: Partial<RuleRow>): RuleRow => ({
  id: 1,
  field: "description",
  matchType: "contains",
  pattern: "grocery",
  amountMinCents: null,
  amountMaxCents: null,
  categoryId: 99,
  priority: 0,
  enabled: true,
  direction: "any",
  ...over,
});

describe("categorize precedence", () => {
  const tx = { description: "FAKE GROCERY", counterparty: "Fake Grocery", amountCents: -1234, mcc: "5411" };
  it("rule beats MCC", () => {
    expect(categorize(tx, [rule({})], ids)).toEqual({ categoryId: 99, source: "rule" });
  });
  it("MCC beats the income/other default", () => {
    expect(categorize(tx, [], ids)).toEqual({ categoryId: 1, source: "provider" });
  });
  it("positive without MCC is Income, negative is Other", () => {
    expect(categorize({ ...tx, mcc: null, amountCents: 5000 }, [], ids).categoryId).toBe(10);
    expect(categorize({ ...tx, mcc: null }, [], ids).categoryId).toBe(12);
  });
  it("higher priority rule wins, disabled rules ignored", () => {
    const rs = [
      rule({ id: 1, categoryId: 1, priority: 1 }),
      rule({ id: 2, categoryId: 99, priority: 5 }),
      rule({ id: 3, categoryId: 12, priority: 9, enabled: false }),
    ];
    expect(categorize(tx, rs, ids).categoryId).toBe(99);
  });
  it("respects amount bounds, equals, regex and counterparty field", () => {
    expect(categorize(tx, [rule({ amountMinCents: 5000 })], ids).source).toBe("provider");
    expect(categorize(tx, [rule({ amountMaxCents: 2000 })], ids).source).toBe("rule");
    expect(categorize(tx, [rule({ matchType: "equals", pattern: "fake grocery" })], ids).source).toBe("rule");
    expect(categorize(tx, [rule({ matchType: "equals", pattern: "grocery" })], ids).source).toBe("provider");
    expect(categorize(tx, [rule({ matchType: "regex", pattern: "^fake\\s+groc" })], ids).source).toBe("rule");
    expect(categorize(tx, [rule({ matchType: "regex", pattern: "(" })], ids).source).toBe("provider");
    expect(categorize(tx, [rule({ field: "counterparty", pattern: "fake gro" })], ids).source).toBe("rule");
  });
});

function monthly(key: string, amount: number, dates: string[], label = key): RecurringInput[] {
  return dates.map((date) => ({ merchantKey: key, date, amountCents: amount, label, categoryId: null }));
}

describe("recurring detection", () => {
  const today = "2025-11-18";
  it("finds a monthly charge", () => {
    const r = detectRecurring(monthly("fake stream", -1599, ["2025-08-15", "2025-09-15", "2025-10-15"]), today);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      cadence: "monthly",
      occurrences: 3,
      avgAmountCents: -1599,
      lastDate: "2025-10-15",
      nextExpected: "2025-11-15",
    });
  });
  it("finds weekly and biweekly", () => {
    const w = detectRecurring(monthly("gym", -1000, ["2025-10-27", "2025-11-03", "2025-11-10", "2025-11-17"]), today);
    expect(w[0].cadence).toBe("weekly");
    const b = detectRecurring(monthly("pay", 200000, ["2025-10-03", "2025-10-17", "2025-10-31", "2025-11-14"]), today);
    expect(b[0].cadence).toBe("biweekly");
  });
  it("needs 3 hits", () => {
    expect(detectRecurring(monthly("x", -500, ["2025-09-15", "2025-10-15"]), today)).toHaveLength(0);
  });
  it("rejects amounts outside 15% unless the timing is very regular (then variable)", () => {
    const bad = [...monthly("x", -1000, ["2025-08-15", "2025-09-15"]), ...monthly("x", -1300, ["2025-10-21"])];
    expect(detectRecurring(bad, today)).toHaveLength(0); // loose timing and a spread: not recurring
    const usage = [...monthly("x", -1000, ["2025-08-15", "2025-09-15"]), ...monthly("x", -1300, ["2025-10-15"])];
    expect(detectRecurring(usage, today)[0].variableAmount).toBe(true);
    const ok = [...monthly("x", -1000, ["2025-08-15", "2025-09-15"]), ...monthly("x", -1100, ["2025-10-15"])];
    expect(detectRecurring(ok, today)).toHaveLength(1);
  });
  it("rejects irregular intervals", () => {
    expect(detectRecurring(monthly("x", -500, ["2025-09-01", "2025-09-05", "2025-10-20"]), today)).toHaveLength(0);
  });
  it("drops merchants that stopped long ago", () => {
    expect(detectRecurring(monthly("x", -500, ["2025-01-15", "2025-02-15", "2025-03-15"]), today)).toHaveLength(0);
  });
  it("adds months with clamping", () => {
    expect(addCadence("2025-01-31", "monthly")).toBe("2025-02-28");
    expect(addCadence("2025-12-15", "monthly")).toBe("2026-01-15");
    expect(addCadence("2025-03-01", "yearly")).toBe("2026-03-01");
  });
});
