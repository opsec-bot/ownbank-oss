import { formatCents } from "./networth";
import { parseMarkdown, type Inline } from "./markdown";
import type { DigestData } from "./digest";

// The digest screen draws numbers from DigestData itself. Claude only supplies a one-line verdict and up to
// three actions. Expected format (the 8 AM routine is told to write exactly this):
//   # Spend nothing until payday
//   - Hold the $65 save until checking is back over $50
//   - ...
// Older long-form digests still work: first heading (or first paragraph's first sentence) is the verdict and
// the last bullet list gives the actions.

export const MAX_ACTIONS = 3;
const MAX_VERDICT = 90;

export type DigestNote = { verdict: string | null; actions: string[] };

const plain = (parts: Inline[]) => parts.map((p) => p.text).join("").trim();

function firstSentence(s: string): string {
  const m = s.match(/^.+?[.!?](\s|$)/);
  return (m ? m[0] : s).trim();
}

function clip(s: string): string {
  return s.length > MAX_VERDICT ? s.slice(0, MAX_VERDICT - 1).trimEnd() + "…" : s;
}

export function parseDigestNote(md: string): DigestNote {
  const blocks = parseMarkdown(md);
  let verdict: string | null = null;
  for (const b of blocks) {
    if (b.type === "heading") {
      const t = plain(b.inline);
      // The auto digest and older Claude ones start with a date title, which is not a verdict.
      if (t && !/^digest\b/i.test(t)) {
        verdict = t;
        break;
      }
    } else if (b.type === "paragraph") {
      const t = plain(b.inline);
      if (t) {
        verdict = firstSentence(t);
        break;
      }
    }
  }
  const lists = blocks.filter((b) => b.type === "list");
  const last = lists[lists.length - 1];
  const actions =
    last && last.type === "list"
      ? last.items.filter((i) => i.depth === 0).map((i) => plain(i.inline)).filter(Boolean).slice(0, MAX_ACTIONS)
      : [];
  return { verdict: verdict ? clip(verdict) : null, actions };
}

// Used when there is no Claude digest for today: a plain verdict from the numbers.
export function autoVerdict(d: DigestData): string {
  if (d.connection.status === "broken") return "Bank connection broken: fix it in Settings";
  const safe = d.safeToSpend.safeCents;
  if (safe <= 0) return d.forecast.nextIncomeDate ? "Spend nothing until payday" : "Spend nothing today";
  return `You can spend ${formatCents(safe)} today`;
}
