import { describe, expect, it } from "vitest";
import { displayAccountName, formatCents, netWorthCents, timeAgo } from "@/lib/finance/networth";

describe("netWorthCents", () => {
  it("adds depository, subtracts card debt, adds crypto", () => {
    const accounts = [
      { type: "depository", balanceLedgerCents: 10000 },
      { type: "depository", balanceLedgerCents: 5000 },
      { type: "credit", balanceLedgerCents: -2500 },
      { type: "credit", balanceLedgerCents: 1000 }, // reported positive: still debt
      { type: "depository", balanceLedgerCents: 99999, hidden: true },
      { type: "depository", balanceLedgerCents: null },
    ];
    expect(netWorthCents(accounts, [{ totalUsdCents: 3000 }, { totalUsdCents: 500 }])).toBe(10000 + 5000 - 2500 - 1000 + 3500);
  });
});

describe("formatters", () => {
  it("formats cents", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-5)).toBe("-$0.05");
    expect(formatCents(0)).toBe("$0.00");
  });
  it("cleans account names", () => {
    expect(displayAccountName("Fake Checking- 1234 (1234)")).toBe("Fake Checking");
    expect(displayAccountName("Fake Rewards Visa Card (9876)")).toBe("Fake Rewards Visa Card");
    expect(displayAccountName("Plain")).toBe("Plain");
    expect(displayAccountName("1234")).toBe("1234");
  });
  it("formats ages", () => {
    const now = 1_000_000_000_000;
    expect(timeAgo(null, now)).toBe("never");
    expect(timeAgo(now - 30_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(timeAgo(now - 3 * 3600_000, now)).toBe("3 h ago");
    expect(timeAgo(now - 72 * 3600_000, now)).toBe("3 d ago");
  });
});
