import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb, type DB } from "@/lib/db";
import { digestEnabled, SCOPE_WRITE, writeEnabled } from "@/lib/oauth/config";
import { hasScope, type Principal } from "./auth";
import { toolText, ToolError } from "./format";
import { requiredScope, TOOLS, type ToolDef } from "./tools";

import { zoneLabel } from "@/lib/timezone";

export const SERVER_NAME = "ownbank";
export const SERVER_VERSION = "0.1.0";

export const INSTRUCTIONS = `ownbank is the owner's private personal finance app. It holds bank transactions (one checking and one savings account), bills, budgets, a savings goal, and crypto wallet balances.

Money: amounts are dollar strings with 2 decimals. Negative means money out, positive means money in. Fields ending in Usd are dollars.
Trading wallets (memecoin trading) are NOT part of net worth: money moved into one counts as spending. Savings wallets are counted.
Use get_digest_data for daily summaries and morning digests. Use can_afford for "can I afford X" questions and safe_to_spend for "how much can I spend". Use save_plan for how much to move to savings.
Check sync_status if numbers look stale. Dates are YYYY-MM-DD in the owner's timezone (${zoneLabel()}).
Be direct. Give the number first, then one line of why. Do not invent figures: if a tool does not return it, say you do not have it.`;

// Which tools this caller may see. Scopes decide read vs write; MCP_WRITE_ENABLED and MCP_DIGEST_ENABLED switch groups off.
export function toolsFor(p: Principal): ToolDef[] {
  return TOOLS.filter((t) => {
    if (!hasScope(p, requiredScope(t.kind))) return false;
    if (t.kind === "write") return writeEnabled() && hasScope(p, SCOPE_WRITE);
    if (t.kind === "digest") return digestEnabled();
    return true;
  });
}

// Fresh server per request (stateless transport). Tool handlers get the db and clock; they never see the token.
export function buildMcpServer(p: Principal, opts: { db?: DB; now?: () => number } = {}): McpServer {
  const db = opts.db ?? getDb();
  const clock = opts.now ?? Date.now;
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  for (const tool of toolsFor(p)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly,
          destructiveHint: false,
          idempotentHint: tool.idempotent,
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.run({ db, now: clock() }, args);
          return { content: [{ type: "text" as const, text: toolText(result) }] };
        } catch (e) {
          if (e instanceof ToolError) return { isError: true, content: [{ type: "text" as const, text: e.message }] };
          // Do not echo internals (they can hold row data). Log the error name only.
          console.error(`mcp tool ${tool.name} failed:`, e instanceof Error ? e.name : "unknown");
          return { isError: true, content: [{ type: "text" as const, text: "The tool failed. Try again or check sync_status." }] };
        }
      },
    );
  }
  return server;
}
