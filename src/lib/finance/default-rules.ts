// Built-in payee keyword rules. They are seeded by migration 0005 (generated from this list by
// scripts/gen-default-rules-sql.ts) with is_default = 1 and priority -100, so any user rule wins.
// Order matters among defaults (lower id wins on ties): specific patterns come before general ones.
// Short or ambiguous names use word-bounded regexes ("nsf" must not match inside "transfer").
// Every expense rule is direction "out": an inflow (paycheck, refund) can never be filed as spending.

export type Direction = "out" | "in" | "any";
export type DefaultRule = { pattern: string; matchType: "contains" | "regex"; category: string; direction: Direction };

export const DEFAULT_RULE_PRIORITY = -100;

const c = (category: string, direction: Direction, ...patterns: string[]): DefaultRule[] =>
  patterns.map((pattern) => ({ pattern, matchType: "contains" as const, category, direction }));
const r = (category: string, direction: Direction, ...patterns: string[]): DefaultRule[] =>
  patterns.map((pattern) => ({ pattern, matchType: "regex" as const, category, direction }));

export const DEFAULT_RULES: DefaultRule[] = [
  // Exchanges: money moving to savings (out) or coming back from it (in) is a transfer either way.
  ...c("Savings transfer", "any", "coinbase", "kraken", "moonpay", "phantom", "binance", "gemini", "robinhood crypto"),
  ...r("Savings transfer", "any", "cash app\\W{0,3}bitcoin"),
  ...c("Personal transfer", "any", "zelle", "venmo", "cash app", "paypal"),

  // Wages arriving. Earned-wage payouts and payroll show up many times a week.
  ...c("Income", "in", "dailypay", "daily pay", "payroll", "direct dep", "resale pay"),

  // Moves between the owner's own accounts.
  ...c("Transfer", "any", "online banking transfer", "mobile banking transfer"),
  ...r("Transfer", "in", "\\btransfer from (chk|checking|sav|savings)\\b"),

  ...r("Fees", "out", "\\bnsf\\b", "\\boverdraft\\b"),
  ...c("Fees", "out", "monthly maintenance", "service fee", "instant transfer fee"),
  ...c("Cash & ATM", "out", "atm withdrawal"),

  ...c("Subscriptions", "out", "netflix", "spotify", "apple.com/bill", "amazon prime", "hulu", "disney", "openai", "anthropic", "claude", "chatgpt", "github", "discord", "xbox", "playstation", "youtube", "google"),
  ...r("Subscriptions", "out", "\\bsteam(games|powered|\\b)"),

  ...c("Groceries", "out", "walmart grocery", "kroger", "aldi", "costco", "tom thumb", "whole foods", "trader joe"),
  ...r("Groceries", "out", "\\bheb\\b"),

  ...c("Dining", "out", "mcdonald", "chick-fil-a", "starbucks", "taco bell", "wendy", "chipotle", "doordash", "uber eats", "grubhub", "whataburger", "raising cane", "sweetgreen", "panera", "panda express", "five guys", "dunkin", "domino", "pizza", "coffee", "restaurant"),
  ...r("Dining", "out", "\\bsonic\\b"),

  ...c("Transport", "out", "lyft", "exxon", "chevron", "quiktrip", "racetrac", "7-eleven fuel", "buc-ee", "uber"),
  ...r("Transport", "out", "\\bshell\\b", "\\bqt\\b"),

  // Housing, utilities, phone, internet and insurance. "rent" is word-bounded so "current" or "parent" never match.
  ...r("Bills & Utilities", "out", "\\brent\\b", "\\bapts?\\b", "\\bapartments?\\b", "\\bmortgage\\b", "\\bhoa\\b"),
  ...c("Bills & Utilities", "out", "property mgmt", "power & light", "electric", "energy", "water util", "utilities", "internet", "spectrum", "comcast", "xfinity", "at&t", "verizon", "t-mobile", "mint mobile", "geico", "progressive ins", "state farm", "allstate", "insurance"),

  ...c("Health", "out", "cvs/pharmacy", "walgreens", "pharmacy", "planet fitness", "fitness", "dental", "medical"),
  ...r("Health", "out", "\\bgym\\b"),

  ...c("Entertainment", "out", "amc theatres", "cinemark", "regal", "ticketmaster", "stubhub", "theatre", "cinema"),

  ...c("Income", "in", "interest earned", "interest paid", "dividend"),

  ...c("Shopping", "out", "amazon", "target", "best buy", "walmart"),
];
