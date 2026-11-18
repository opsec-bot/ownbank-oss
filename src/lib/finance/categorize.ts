// Category assignment: manual (never touched) > rules (sign-aware) > MCC map > Income/Refund (positive) > Other.

export const MIN_INCOME_CENTS = 2000;

export type CategorySource = "provider" | "rule" | "manual";

export type RuleRow = {
  id: number;
  field: "description" | "counterparty" | "any";
  matchType: "contains" | "equals" | "regex";
  pattern: string;
  amountMinCents: number | null;
  amountMaxCents: number | null;
  categoryId: number;
  priority: number;
  enabled: boolean;
  direction: "out" | "in" | "any";
};

const GROCERIES = new Set([5300, 5411, 5422, 5441, 5451, 5462, 5499]);
const TRANSPORT = new Set([4111, 4112, 4121, 4131, 4784, 4789, 5541, 5542, 5532, 7523, 7524, 7531, 7534, 7535, 7538, 7542, 7549]);
const BILLS = new Set([4814, 4816, 4821, 4899, 4900, 6300, 6381, 6399, 9311]);
const ENTERTAINMENT = new Set([7829, 7832, 7841]);
const TRANSFER = new Set([4829, 6051]);

function inRange(n: number, lo: number, hi: number): boolean {
  return n >= lo && n <= hi;
}

// Returns a category NAME (matching the seeded categories) or null when the MCC says nothing useful.
export function mccToCategory(mcc: string | number | null | undefined): string | null {
  if (mcc === null || mcc === undefined || mcc === "") return null;
  const n = Number(mcc);
  if (!Number.isInteger(n)) return null;

  if (GROCERIES.has(n)) return "Groceries";
  if (inRange(n, 5811, 5814)) return "Dining";
  if (inRange(n, 5815, 5818)) return "Subscriptions";
  if (TRANSPORT.has(n)) return "Transport";
  if (BILLS.has(n)) return "Bills & Utilities";
  if (TRANSFER.has(n)) return "Transfer";
  // Airlines, hotels, car rental, cruises, travel agencies.
  if (inRange(n, 3000, 3999) || n === 4511 || n === 7011 || n === 4722 || n === 4411 || n === 7512 || n === 7513) return "Travel";
  if (ENTERTAINMENT.has(n) || inRange(n, 7911, 7999)) return "Entertainment";
  if (inRange(n, 8011, 8099) || n === 5912) return "Health";
  // General merchandise, home, clothing, electronics, misc retail.
  if (inRange(n, 5200, 5399) || inRange(n, 5600, 5799) || inRange(n, 5900, 5999)) return "Shopping";
  return null;
}

export function matchesRule(
  rule: RuleRow,
  tx: { description: string; counterparty: string | null; amountCents: number },
): boolean {
  // A rule only applies to the sign it was written for.
  if (rule.direction === "out" && tx.amountCents >= 0) return false;
  if (rule.direction === "in" && tx.amountCents <= 0) return false;
  // Bounds compare the absolute amount so "over $100" means the same for spending and income.
  const abs = Math.abs(tx.amountCents);
  if (rule.amountMinCents !== null && abs < rule.amountMinCents) return false;
  if (rule.amountMaxCents !== null && abs > rule.amountMaxCents) return false;
  const values =
    rule.field === "counterparty"
      ? [tx.counterparty ?? ""]
      : rule.field === "description"
        ? [tx.description]
        : [tx.description, tx.counterparty ?? ""]; // "any"
  const p = rule.pattern.toLowerCase();
  if (rule.matchType === "regex") {
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern, "i");
    } catch {
      return false;
    }
    return values.some((v) => re.test(v));
  }
  return values.some((value) => {
    const v = value.toLowerCase();
    return rule.matchType === "equals" ? v === p : p !== "" && v.includes(p);
  });
}

export function categorize(
  tx: { description: string; counterparty: string | null; amountCents: number; mcc: string | null },
  rules: RuleRow[],
  categoryIdByName: Map<string, number>,
): { categoryId: number | null; source: CategorySource } {
  // Higher priority first, then oldest rule first.
  const ordered = rules.filter((r) => r.enabled).sort((a, b) => b.priority - a.priority || a.id - b.id);
  for (const r of ordered) {
    if (matchesRule(r, tx)) return { categoryId: r.categoryId, source: "rule" };
  }
  const byMcc = mccToCategory(tx.mcc);
  if (byMcc) {
    const id = categoryIdByName.get(byMcc);
    if (id !== undefined) return { categoryId: id, source: "provider" };
  }
  // Inflows nobody claimed: real money (>= $20) is income, small ones are refunds.
  const fallback = tx.amountCents > 0 ? (tx.amountCents >= MIN_INCOME_CENTS ? "Income" : "Refund") : "Other";
  return { categoryId: categoryIdByName.get(fallback) ?? null, source: "provider" };
}
