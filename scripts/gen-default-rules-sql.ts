// Prints the INSERT statements for the default-rules migrations (0005, 0010) from src/lib/finance/default-rules.ts.
import { DEFAULT_RULES, DEFAULT_RULE_PRIORITY } from "../src/lib/finance/default-rules";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const stamp = 1794990000000;
const lines = DEFAULT_RULES.map(
  (r) =>
    "INSERT INTO `rules` (`field`, `match_type`, `pattern`, `category_id`, `priority`, `enabled`, `created_at`, `is_default`, `direction`) " +
    `SELECT 'any', ${q(r.matchType)}, ${q(r.pattern)}, \`id\`, ${DEFAULT_RULE_PRIORITY}, 1, ${stamp}, 1, ${q(r.direction)} FROM \`categories\` WHERE \`name\` = ${q(r.category)};`,
);
console.log(lines.join("\n--> statement-breakpoint\n"));
