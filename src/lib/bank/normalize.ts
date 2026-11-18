// Pure helpers for turning raw bank text and timestamps into stable keys.

import { APP_TIMEZONE } from "@/lib/timezone";

export const TIMEZONE = APP_TIMEZONE;

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Unix seconds -> YYYY-MM-DD in the app timezone.
export function localDate(unixSeconds: number): string {
  return dateFmt.format(new Date(unixSeconds * 1000));
}

const STATES = new Set(
  "al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy".split(" "),
);

// Trailing city names (Dallas-Fort Worth area) that bank text appends after the merchant. They are only dropped when a
// 2-letter state follows, so a merchant that is itself named after a city keeps its name.
const CITIES = new Set([
  "dallas", "fort worth", "arlington", "irving", "garland", "plano", "frisco", "mckinney", "allen", "richardson",
  "carrollton", "farmers branch", "addison", "lewisville", "flower mound", "the colony", "denton", "little elm",
  "lake dallas", "corinth", "highland village", "grapevine", "coppell", "southlake", "mesquite", "rowlett", "wylie",
  "prosper", "celina", "anna", "melissa", "sachse", "murphy", "rockwall", "mansfield", "euless", "bedford", "hurst",
  "keller", "roanoke", "argyle", "hebron", "austin", "houston", "san antonio", "waco", "round rock", "college station",
]);

// Lowercase payee (or description), drop any token with a digit (store numbers, #refs, card tails, dates) except brand
// numbers like "7-11", drop punctuation, then drop the trailing state and city.
// "FAKE GROCERY #123 DALLAS TX" -> "fake grocery"; "7-11 #10452 DALLAS TX" -> "7-11".
export function merchantKey(payee: string | null | undefined, description: string): string {
  const rawText = payee && payee.trim() ? payee : description;
  const raw = rawText.toLowerCase();
  const parts = rawText.split(/[\s*#/|]+/).filter(Boolean);
  const tokens: { text: string; upper: boolean }[] = [];
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (/^\d{1,2}-(\d{1,2}|[a-z]+)$/.test(lower)) {
      tokens.push({ text: lower, upper: false });
      continue;
    }
    if (/\d/.test(lower)) continue;
    const text = lower.replace(/[^a-z&']/g, "");
    if (text) tokens.push({ text, upper: p === p.toUpperCase() });
  }
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && last.upper && STATES.has(last.text)) {
    tokens.pop();
    for (const n of [3, 2, 1]) {
      const tail = tokens.slice(-n).map((t) => t.text).join(" ");
      if (tokens.length > n && CITIES.has(tail)) {
        tokens.splice(-n, n);
        break;
      }
    }
  }
  const key = tokens.map((t) => t.text).join(" ").replace(/\s+/g, " ").trim();
  if (key) return key;
  return raw.replace(/\s+/g, " ").trim().slice(0, 60) || "unknown";
}

// Today's date in the app timezone.
export function todayLocal(now = Date.now()): string {
  return localDate(Math.floor(now / 1000));
}
