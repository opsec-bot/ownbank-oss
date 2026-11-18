// Output shaping for MCP tools: money as dollar strings, text with card and account numbers masked.

export class ToolError extends Error {}

export function usd(cents: number): string {
  const n = Math.round(cents);
  const s = (Math.abs(n) / 100).toFixed(2);
  return n < 0 ? `-${s}` : s;
}

const MONEY = /^-?\d+\.\d{2}$/;
const KEEP_KEYS = new Set(["id", "transactionId"]); // provider ids are opaque handles, passed back unchanged

// Card-like digit groups (13 to 19 digits, optional spaces or dashes) keep the last four. Any other run of 5+ digits
// (account numbers, reference numbers) keeps the last four too. ZIPs and store numbers get masked as a side effect.
export function maskText(text: string): string {
  const cards = text.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    const tail = /[ -]+$/.exec(m)?.[0] ?? "";
    return digits.length >= 13 && digits.length <= 19 ? `****${digits.slice(-4)}${tail}` : m;
  });
  return cards.replace(/(?<![\d.])\d{5,}(?!\d|\.\d)/g, (m) => `${"*".repeat(m.length - 4)}${m.slice(-4)}`);
}

// Walks a result and masks every string (except dollar amounts and opaque ids).
export function scrub(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (KEEP_KEYS.has(key) || MONEY.test(value)) return value;
    return maskText(value);
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
  }
  return value;
}

// Renames every fooCents number to fooUsd "12.34" (null stays null), recursively.
export function moneyify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(moneyify);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.endsWith("Cents") && (typeof v === "number" || v === null)) out[`${k.slice(0, -5)}Usd`] = v === null ? null : usd(v);
      else out[k] = moneyify(v);
    }
    return out;
  }
  return value;
}

export function iso(ms: number | null | undefined): string | null {
  return typeof ms === "number" ? new Date(ms).toISOString() : null;
}

// Error text from the app can carry a URL (provider endpoints). Never pass one on.
export function safeError(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.replace(/https?:\/\/\S+/gi, "[url]").slice(0, 200);
}

export function shortText(s: string, max = 80): string {
  const t = maskText(s).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

export function toolText(result: unknown): string {
  return JSON.stringify(scrub(moneyify(result)));
}
