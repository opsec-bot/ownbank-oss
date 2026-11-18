// Guard for regexes that arrive over MCP. A rule regex runs against every transaction on each recategorize, so a
// catastrophic pattern would hang the server. This is a conservative syntax check (no engine access, no timing),
// it rejects anything that can backtrack badly rather than trying to prove a pattern safe.

export const MAX_REGEX_LENGTH = 100;
const MAX_UNBOUNDED = 4;

// Returns a reason the pattern is refused, or null when it is fine.
export function regexProblem(pattern: string): string | null {
  if (pattern.length === 0) return "Pattern is empty";
  if (pattern.length > MAX_REGEX_LENGTH) return `Regex is too long (max ${MAX_REGEX_LENGTH} characters)`;
  try {
    new RegExp(pattern, "i");
  } catch {
    return "That regex does not compile";
  }
  if (/\\[1-9]|\\k</.test(pattern)) return "Backreferences are not allowed";
  if (/\(\?<?[=!]/.test(pattern)) return "Lookahead and lookbehind are not allowed";

  type Frame = { hasUnbounded: boolean; hasAlt: boolean };
  const stack: Frame[] = [];
  let unbounded = 0;
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") {
      inClass = true;
      continue;
    }
    if (c === "(") {
      stack.push({ hasUnbounded: false, hasAlt: false });
      continue;
    }
    if (c === "|") {
      const top = stack[stack.length - 1];
      if (top) top.hasAlt = true;
      continue;
    }
    let quantUnbounded = false;
    if (c === "*" || c === "+") quantUnbounded = true;
    else if (c === "{") {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
      if (m) {
        if (m[2] !== undefined && (m[3] === "" || Number(m[3]) > 20)) quantUnbounded = true;
        else if (Number(m[1]) > 20) quantUnbounded = true;
        i += m[0].length - 1;
      }
    }
    if (quantUnbounded) {
      unbounded++;
      const top = stack[stack.length - 1];
      if (top) top.hasUnbounded = true;
    }
    if (c === ")") {
      const frame = stack.pop();
      if (!frame) continue;
      const next = pattern[i + 1];
      const quantified = next === "*" || next === "+" || (next === "{" && /^\{\d+(,\d*)?\}/.test(pattern.slice(i + 1)));
      if (quantified) {
        if (frame.hasUnbounded) return "Nested repetition is not allowed (for example (a+)+)";
        if (frame.hasAlt) return "A repeated group may not contain alternation";
        unbounded++; // the group repeat itself
        const parent = stack[stack.length - 1];
        if (parent) parent.hasUnbounded = true;
      } else {
        const parent = stack[stack.length - 1];
        if (parent) {
          parent.hasUnbounded ||= frame.hasUnbounded;
          parent.hasAlt ||= frame.hasAlt;
        }
      }
    }
  }
  if (unbounded > MAX_UNBOUNDED) return `Too many open-ended repeats (max ${MAX_UNBOUNDED})`;
  return null;
}
