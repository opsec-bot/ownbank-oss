// Turns raw bank text ("SHELL OIL 57442", "AMAZON.COM*2K4LM", "ONLINE BANKING TRANSFER TO SAV 4471") into a name a
// person would write ("Shell", "Amazon", "Transfer to savings"). Display only: matching and grouping still use the raw
// description and merchant_key. Works on raw descriptions and on lowercase merchant keys alike.

// Well-known brands, checked in order against the lowercased text. First hit wins.
const BRANDS: [RegExp, string][] = [
  [/uber\s*\*?\s*eats/, "Uber Eats"],
  [/doordash/, "DoorDash"],
  [/grubhub/, "Grubhub"],
  [/\buber\b/, "Uber"],
  [/\blyft\b/, "Lyft"],
  [/amazon\s*prime/, "Amazon Prime"],
  [/amazon|amzn/, "Amazon"],
  [/apple\.?com\/?bill/, "Apple"],
  [/netflix/, "Netflix"],
  [/spotify/, "Spotify"],
  [/\bhulu\b/, "Hulu"],
  [/disney/, "Disney+"],
  [/youtube/, "YouTube"],
  [/google/, "Google"],
  [/anthropic|claude\.?ai/, "Claude"],
  [/openai|chatgpt/, "OpenAI"],
  [/github/, "GitHub"],
  [/\bsteam/, "Steam"],
  [/playstation/, "PlayStation"],
  [/xbox/, "Xbox"],
  [/coinbase/, "Coinbase"],
  [/kraken/, "Kraken"],
  [/robinhood/, "Robinhood"],
  [/paypal/, "PayPal"],
  [/venmo/, "Venmo"],
  [/zelle/, "Zelle"],
  [/cash\s*app/, "Cash App"],
  [/chick-?fil-?a/, "Chick-fil-A"],
  [/mcdonald/, "McDonald's"],
  [/starbucks/, "Starbucks"],
  [/chipotle/, "Chipotle"],
  [/taco\s*bell/, "Taco Bell"],
  [/sweetgreen/, "Sweetgreen"],
  [/panera/, "Panera"],
  [/dunkin/, "Dunkin'"],
  [/whataburger/, "Whataburger"],
  [/raising\s*cane/, "Raising Cane's"],
  [/trader\s*joe/, "Trader Joe's"],
  [/whole\s*foods/, "Whole Foods"],
  [/kroger/, "Kroger"],
  [/\baldi\b/, "Aldi"],
  [/costco/, "Costco"],
  [/walmart|wal-mart|wm\s*supercenter/, "Walmart"],
  [/\btarget\b/, "Target"],
  [/best\s*buy/, "Best Buy"],
  [/7-?eleven|7-11/, "7-Eleven"],
  [/\bshell\b/, "Shell"],
  [/chevron/, "Chevron"],
  [/exxon/, "Exxon"],
  [/quiktrip|\bqt\b/, "QuikTrip"],
  [/racetrac/, "RaceTrac"],
  [/buc-?ee/, "Buc-ee's"],
  [/\bcvs\b/, "CVS"],
  [/walgreens/, "Walgreens"],
  [/planet\s*fitness/, "Planet Fitness"],
  [/\bamc\b/, "AMC Theatres"],
  [/ticketmaster/, "Ticketmaster"],
  [/t-?mobile/, "T-Mobile"],
  [/at&t|\batt\b/, "AT&T"],
  [/verizon/, "Verizon"],
  [/spectrum/, "Spectrum"],
  [/comcast|xfinity/, "Xfinity"],
  [/geico/, "GEICO"],
  [/state\s*farm/, "State Farm"],
  [/progressive/, "Progressive"],
  [/allstate/, "Allstate"],
];

const ACCOUNT_WORDS: Record<string, string> = { sav: "savings", savings: "savings", chk: "checking", checking: "checking" };

// Bank boilerplate that says how a payment was made, not who it went to.
const NOISE = new Set([
  "pos", "debit", "credit", "card", "purchase", "ach", "web", "online", "pmt", "payment", "pymt", "bill", "pay", "autopay",
  "recurring", "subscription", "direct", "dep", "deposit", "club", "fees", "store", "inc", "llc", "co", "corp", "ppd", "id",
]);
// Short words that stay upper case.
const UPPER = new Set(["usa", "atm", "hoa", "llc", "ups", "usps", "irs", "dmv", "bp", "qt", "hbo", "nyc", "dfw"]);
const SMALL = new Set(["and", "of", "the", "to", "from", "for", "at", "on", "in"]);

function titleWord(w: string, i: number): string {
  if (UPPER.has(w)) return w.toUpperCase();
  if (i > 0 && SMALL.has(w)) return w;
  return w.replace(/(^|[-'])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

export function merchantName(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "Unknown";
  const lower = text.toLowerCase();

  const transfer = lower.match(/transfer\s+(to|from)\s+(sav|savings|chk|checking)\b/);
  if (transfer) return `Transfer ${transfer[1]} ${ACCOUNT_WORDS[transfer[2]]}`;
  if (/interest\s+(earned|paid)/.test(lower)) return "Interest";

  for (const [re, name] of BRANDS) if (re.test(lower)) return name;

  // Fallback: keep the words, drop numbers, refs, ".com" and payment boilerplate, then title case.
  const words = lower
    .replace(/\.com\b/g, " ")
    .split(/[\s*#/|,.]+/)
    .filter((w) => w && !/\d/.test(w))
    .map((w) => w.replace(/[^a-z&'-]/g, ""))
    .filter(Boolean);
  // Strip noise from the end only, so a name like "Pay Less" survives.
  while (words.length > 1 && NOISE.has(words[words.length - 1])) words.pop();
  const kept = words.slice(0, 5);
  if (kept.length === 0) return text.slice(0, 40);
  return kept.map(titleWord).join(" ");
}
