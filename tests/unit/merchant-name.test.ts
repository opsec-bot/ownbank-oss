import { describe, expect, it } from "vitest";
import { merchantName } from "@/lib/finance/merchant-name";

describe("merchantName", () => {
  const cases: [string, string][] = [
    ["SHELL OIL 57442", "Shell"],
    ["AMAZON.COM*2K4LM", "Amazon"],
    ["amazoncom", "Amazon"],
    ["ANTHROPIC CLAUDE.AI SUBSCRIPTION", "Claude"],
    ["T-MOBILE AUTOPAY", "T-Mobile"],
    ["tmobile autopay", "T-Mobile"],
    ["CHICK-FIL-A #0198", "Chick-fil-A"],
    ["CVS/PHARMACY #0412", "CVS"],
    ["AMC THEATRES 2201", "AMC Theatres"],
    ["DOORDASH*THAI BASIL", "DoorDash"],
    ["UBER *TRIP", "Uber"],
    ["UBER EATS 8812", "Uber Eats"],
    ["ONLINE BANKING TRANSFER TO SAV 4471", "Transfer to savings"],
    ["ONLINE BANKING TRANSFER FROM CHK 2208", "Transfer from checking"],
    ["INTEREST EARNED", "Interest"],
    ["CITY POWER & LIGHT BILL PAY", "City Power & Light"],
    ["MAPLE COURT APTS RENT ONLINE PMT", "Maple Court Apts Rent"],
    ["NORTHWIND LABS PAYROLL DIRECT DEP", "Northwind Labs Payroll"],
    ["PLANET FITNESS CLUB FEES", "Planet Fitness"],
    ["WHOLE FOODS MKT", "Whole Foods"],
    ["SPOTIFY USA", "Spotify"],
    ["7-11 #38113", "7-Eleven"],
    ["", "Unknown"],
  ];
  it.each(cases)("%s -> %s", (raw, want) => expect(merchantName(raw)).toBe(want));

  it("keeps a name that only looks like noise at the end", () => {
    expect(merchantName("PAY LESS")).toBe("Pay Less");
  });
  it("does not match brands inside other words", () => {
    expect(merchantName("SHELLFISH SHACK 22")).toBe("Shellfish Shack");
  });
});
