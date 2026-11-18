// End-to-end test of /api/mcp and the OAuth server against a real built server.
// Needs `npm run build` first. Runs on a COPY of the dev database (VACUUM INTO a temp file, deleted afterwards), with a
// temp owner, no bank sync, no scheduler and push/ntfy turned off. It prints counts and key names only, never data.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "@/lib/auth/password";
import { hashToken } from "@/lib/auth/session";

const PORT = Number(process.env.INTEGRATION_PORT ?? 3457);
const BASE = `http://localhost:${PORT}`;
const MCP_URL = `${BASE}/api/mcp`;
const STATIC_TOKEN = randomBytes(24).toString("base64url");
const SOURCE_DB = process.env.INTEGRATION_SOURCE_DB ?? path.resolve("data", "ownbank.db");
const CALLBACK = "http://localhost:9/cb";

let tmp: string;
let dbFile: string;
let server: ChildProcess | undefined;
let sessionCookie: string;
const serverLog: string[] = [];

function pkce() {
  const verifier = randomBytes(40).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function waitForHealth() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error(`server exited early (${server.exitCode}): ${serverLog.join("").slice(-500)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start: ${serverLog.join("").slice(-500)}`);
}

beforeAll(async () => {
  expect(fs.existsSync(path.resolve(".next", "BUILD_ID")), "run npm run build first").toBe(true);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ownbank-it-"));
  dbFile = path.join(tmp, "copy.db");

  // Clean copy of the dev DB.
  const src = new Database(SOURCE_DB, { readonly: true, fileMustExist: true });
  src.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`);
  src.close();

  // Temp owner + session, bank connection marked broken so nothing can sync, push devices removed.
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  const hash = await hashPassword("integration-test-password");
  db.exec("DELETE FROM sessions; DELETE FROM users;");
  const owner = db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?) RETURNING id").get("it-owner@example.com", hash, Date.now()) as { id: number };
  sessionCookie = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(hashToken(sessionCookie), owner.id, Date.now() + 3_600_000, Date.now());
  try {
    db.exec("UPDATE connections SET status = 'broken'");
    db.exec("DELETE FROM push_subscriptions");
  } catch {
    // an older copy may not have these rows yet, the server migrates on boot
  }
  db.close();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(PORT),
    DATABASE_PATH: dbFile,
    TOKEN_ENC_KEY: randomBytes(32).toString("base64"),
    APP_URL: BASE,
    MCP_TOKEN: STATIC_TOKEN,
    MCP_WRITE_ENABLED: "1",
    MCP_DIGEST_ENABLED: "",
    DISABLE_SYNC_TIMER: "1",
    DISABLE_SCHEDULER: "1",
    // Defined-but-empty beats .env.local, so nothing real is reachable from the test server.
    SYNC_SECRET: "",
    HELIUS_RPC_URL: "",
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
    VAPID_SUBJECT: "",
    NTFY_TOPIC: "",
    NTFY_URL: "",
    NTFY_TOKEN: "",
  };
  server = spawn(process.execPath, [path.resolve("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout?.on("data", (d) => serverLog.push(String(d)));
  server.stderr?.on("data", (d) => serverLog.push(String(d)));
  await waitForHealth();
});

afterAll(() => {
  if (server?.pid) spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  // Give Windows a moment to release the sqlite files, then remove the copy of the real data.
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      break;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
});

async function connect(token: string) {
  const client = new Client({ name: "ownbank-it", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  await client.connect(transport);
  return client;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date();
const START = ymd(new Date(today.getTime() - 90 * 86_400_000));
const END = ymd(today);

const READ_CALLS: [string, Record<string, unknown>][] = [
  ["get_balances", {}],
  ["list_transactions", { start: START, end: END, limit: 500 }],
  ["spending_by_category", { start: START, end: END }],
  ["spending_by_merchant", { start: START, end: END, limit: 100 }],
  ["compare_periods", { a_start: START, a_end: ymd(new Date(today.getTime() - 45 * 86_400_000)), b_start: ymd(new Date(today.getTime() - 44 * 86_400_000)), b_end: END }],
  ["cash_flow", { start: START, end: END }],
  ["list_recurring_charges", {}],
  ["forecast_month_end", {}],
  ["sync_status", {}],
  ["safe_to_spend", {}],
  ["can_afford", { amount: 25 }],
  ["save_plan", {}],
  ["budgets_status", {}],
  ["savings_goal", {}],
  ["get_digest_data", {}],
  ["list_categories", {}],
  ["list_rules", { include_defaults: true }],
];

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((c) => c.text ?? "").join("");
}

// Fields named id are opaque provider handles that tools hand back so a transaction can be recategorized: skipped.
function withoutIds(v: unknown, key = ""): unknown {
  if (key === "id") return null;
  if (Array.isArray(v)) return v.map((x) => withoutIds(x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutIds(x, k)]));
  return v;
}

// Diagnostic that never prints data: key name plus the value's shape (digits -> d, letters -> a).
function offenderShapes(v: unknown, key = "", out = new Set<string>()): Set<string> {
  if (typeof v === "string") {
    if (/^-?\d+\.\d{2}$/.test(v)) return out;
    if (/\d{5,}/.test(v)) out.add(`${key}:${v.replace(/\d/g, "d").replace(/[A-Za-z]/g, "a").slice(0, 40)}`);
  } else if (Array.isArray(v)) v.forEach((x) => offenderShapes(x, key, out));
  else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => offenderShapes(x, k, out));
  return out;
}

// 5+ digit runs that are not part of a dollar amount (those have a .dd tail), ignoring id fields.
function suspiciousNumbers(text: string): number {
  const stripped = JSON.stringify(withoutIds(JSON.parse(text)));
  return (stripped.replace(/-?\d+\.\d{2}/g, "").match(/\d{5,}/g) ?? []).length;
}

describe("discovery and auth challenge", () => {
  it("serves /.well-known metadata from the app dir", async () => {
    const pr = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
    expect(pr).toEqual({ resource: MCP_URL, authorization_servers: [BASE], bearer_methods_supported: ["header"], scopes_supported: ["finance:read", "finance:write"] });
    const prPath = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/api/mcp`)).json();
    expect(prPath).toEqual(pr);
    const as = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
    expect(as).toMatchObject({ issuer: BASE, token_endpoint: `${BASE}/api/oauth/token`, code_challenge_methods_supported: ["S256"] });
    expect((await fetch(`${BASE}/.well-known/openid-configuration`)).status).toBe(404);
  });

  it("401s with the resource_metadata challenge", async () => {
    for (const headers of [{}, { Authorization: "Bearer wrong" }] as Record<string, string>[]) {
      const r = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`);
    }
  });

  it("keeps the app pages behind the session", async () => {
    const r = await fetch(`${BASE}/dashboard`, { redirect: "manual" });
    expect([301, 302, 303, 307, 308]).toContain(r.status);
    expect(r.headers.get("location") ?? "").toContain("/login");
    expect((await fetch(`${BASE}/login/verify`, { redirect: "manual" })).status).toBeLessThan(400); // public, bounces to /login without a cookie
  });
});

describe("MCP with the static token", () => {
  it("initializes, lists tools with annotations, and returns the server instructions", async () => {
    const client = await connect(STATIC_TOKEN);
    expect(client.getServerVersion()?.name).toBe("ownbank");
    expect(client.getInstructions()).toMatch(/negative means money out/i);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    console.log(`tools listed: ${tools.length}`);
    for (const [n] of READ_CALLS) expect(names).toContain(n);
    for (const n of ["publish_digest", "recategorize_transaction", "create_rule", "set_budget"]) expect(names).toContain(n);
    for (const t of tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.annotations, t.name).toBeDefined();
      for (const k of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
        expect(typeof t.annotations?.[k], `${t.name}.${k}`).toBe("boolean");
      }
      expect(t.annotations?.openWorldHint).toBe(false);
    }
    await client.close();
  });

  it("calls every read tool and finds no account-number-like digits", async () => {
    const client = await connect(STATIC_TOKEN);
    const sizes: string[] = [];
    for (const [name, args] of READ_CALLS) {
      const res = await client.callTool({ name, arguments: args });
      const text = textOf(res);
      expect(res.isError, `${name}: ${text.slice(0, 120)}`).toBeFalsy();
      expect(() => JSON.parse(text), name).not.toThrow();
      expect(suspiciousNumbers(text), `${name} has a 5+ digit number: ${[...offenderShapes(withoutIds(JSON.parse(text)))].slice(0, 5).join(" | ")}`).toBe(0);
      expect(text, name).not.toMatch(/https?:\/\//);
      sizes.push(`${name}:${text.length}`);
    }
    console.log(`read tools ok (${sizes.length}): ${sizes.join(" ")}`);
    await client.close();
  });

  it("publish_digest stores a digest and does not push anywhere", async () => {
    const client = await connect(STATIC_TOKEN);
    const res = await client.callTool({ name: "publish_digest", arguments: { markdown: "Integration test digest. Nothing to see." } });
    expect(res.isError).toBeFalsy();
    const out = JSON.parse(textOf(res));
    expect(out.stored).toBe(true);
    expect(out.push).not.toBe("sent"); // no devices, no VAPID: nothing may go out
    const db = new Database(dbFile, { readonly: true });
    const row = db.prepare("SELECT source, body_md AS body FROM digests WHERE day = ?").get(out.date) as { source: string; body: string };
    db.close();
    expect(row).toEqual({ source: "claude", body: "Integration test digest. Nothing to see." });
    await client.close();
  });

  it("write tools work on the copy when enabled", async () => {
    const client = await connect(STATIC_TOKEN);
    const res = await client.callTool({ name: "set_budget", arguments: { category: "Dining", monthly_limit: 123.45 } });
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(JSON.parse(textOf(res))).toMatchObject({ category: "Dining", monthlyLimitUsd: "123.45" });
    const bad = await client.callTool({ name: "create_rule", arguments: { pattern: "(a+)+$", match_type: "regex", category: "Dining" } });
    expect(bad.isError).toBe(true);
    await client.close();
  });
});

describe("OAuth flow", () => {
  const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
  let clientId: string;

  async function register(uri = CALLBACK) {
    return fetch(`${BASE}/api/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: [uri], client_name: "Integration client", token_endpoint_auth_method: "none" }),
    });
  }

  function consentFields(html: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const tag of html.match(/<input[^>]*>/g) ?? []) {
      const name = /name="([^"]*)"/.exec(tag)?.[1];
      const value = /value="([^"]*)"/.exec(tag)?.[1];
      if (name && value !== undefined) out[name] = value.replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
    }
    return out;
  }

  async function authorize(p: { challenge: string; scope?: string; state?: string; resource?: string }, decision: "approve" | "deny", csrfOverride?: string) {
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: CALLBACK,
      response_type: "code",
      code_challenge: p.challenge,
      code_challenge_method: "S256",
      state: p.state ?? "xyz",
      ...(p.scope ? { scope: p.scope } : {}),
      ...(p.resource ? { resource: p.resource } : {}),
    });
    const page = await fetch(`${BASE}/oauth/authorize?${q}`, { headers: { Cookie: `ob_session=${sessionCookie}` }, redirect: "manual" });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("form-action 'self' https://claude.ai");
    const html = await page.text();
    expect(html).toContain("Integration client");
    const fields = consentFields(html);
    expect(fields.csrf).toBeTruthy();
    if (csrfOverride !== undefined) fields.csrf = csrfOverride;
    return fetch(`${BASE}/api/oauth/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: `ob_session=${sessionCookie}` },
      body: form({ ...fields, decision }),
    });
  }

  const token = (body: Record<string, string>) =>
    fetch(`${BASE}/api/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(body) });

  it("registers a client and refuses bad redirect URIs", async () => {
    const bad = await register("https://evil.example/cb");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_redirect_uri");
    const ok = await register();
    expect(ok.status).toBe(201);
    const body = await ok.json();
    expect(body).toMatchObject({ token_endpoint_auth_method: "none", redirect_uris: [CALLBACK] });
    clientId = body.client_id;
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("sends a signed-out browser to /login with the full query preserved", async () => {
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: CALLBACK, response_type: "code", code_challenge: pkce().challenge, code_challenge_method: "S256", state: "s1" });
    const r = await fetch(`${BASE}/oauth/authorize?${q}`, { redirect: "manual" });
    expect([302, 303, 307]).toContain(r.status);
    const loc = new URL(r.headers.get("location")!, BASE);
    expect(loc.pathname).toBe("/login");
    const next = loc.searchParams.get("next")!;
    expect(next.startsWith("/oauth/authorize?")).toBe(true);
    expect(new URLSearchParams(next.split("?")[1]).get("state")).toBe("s1");
    expect(new URLSearchParams(next.split("?")[1]).get("client_id")).toBe(clientId);
  });

  it("rejects approve without a valid CSRF token and shows an error page for a bad client", async () => {
    const res = await authorize({ challenge: pkce().challenge }, "approve", "not-the-token");
    expect(res.status).toBe(403);
    const q = new URLSearchParams({ client_id: "ghost", redirect_uri: CALLBACK, response_type: "code", code_challenge: pkce().challenge, code_challenge_method: "S256" });
    const page = await fetch(`${BASE}/oauth/authorize?${q}`, { headers: { Cookie: `ob_session=${sessionCookie}` }, redirect: "manual" });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Unknown client");
  });

  it("deny redirects with access_denied and the state", async () => {
    const res = await authorize({ challenge: pkce().challenge, state: "deny-state" }, "deny");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(`${loc.origin}${loc.pathname}`).toBe(CALLBACK);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("state")).toBe("deny-state");
  });

  it("runs the full flow: approve, token (PKCE), MCP call, refresh, reuse detection", async () => {
    const p = pkce();
    const res = await authorize({ challenge: p.challenge, state: "flow-state", scope: "finance:read finance:write", resource: MCP_URL }, "approve");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(`${loc.origin}${loc.pathname}`).toBe(CALLBACK);
    expect(loc.searchParams.get("state")).toBe("flow-state");
    const code = loc.searchParams.get("code")!;
    expect(code.length).toBeGreaterThan(30);

    // Wrong verifier fails (and burns the code), a second exchange with the right one cannot recover it.
    const wrong = await token({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: CALLBACK, code_verifier: pkce().verifier });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toBe("invalid_grant");

    const p2 = pkce();
    const res2 = await authorize({ challenge: p2.challenge, scope: "finance:read finance:write", resource: MCP_URL }, "approve");
    const code2 = new URL(res2.headers.get("location")!).searchParams.get("code")!;
    const tr = await token({ grant_type: "authorization_code", client_id: clientId, code: code2, redirect_uri: CALLBACK, code_verifier: p2.verifier, resource: MCP_URL });
    expect(tr.status).toBe(200);
    expect(tr.headers.get("cache-control")).toBe("no-store");
    const t1 = await tr.json();
    expect(t1).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "finance:read finance:write" });

    // The code cannot be used twice.
    const replay = await token({ grant_type: "authorization_code", client_id: clientId, code: code2, redirect_uri: CALLBACK, code_verifier: p2.verifier });
    expect(replay.status).toBe(400);
    // ...and a replay kills what it produced, so run the flow again for the rest.
    const p3 = pkce();
    const res3 = await authorize({ challenge: p3.challenge, scope: "finance:read finance:write" }, "approve");
    const code3 = new URL(res3.headers.get("location")!).searchParams.get("code")!;
    const t2 = await (await token({ grant_type: "authorization_code", client_id: clientId, code: code3, redirect_uri: CALLBACK, code_verifier: p3.verifier })).json();
    expect(t2.access_token).toBeTruthy();

    // MCP with the OAuth token (granted both scopes, write is enabled on this server).
    const client = await connect(t2.access_token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["get_balances", "set_budget"]));
    const bal = await client.callTool({ name: "get_balances", arguments: {} });
    expect(bal.isError).toBeFalsy();
    await client.close();

    // Refresh rotates the pair.
    const rr = await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: t2.refresh_token });
    expect(rr.status).toBe(200);
    const t3 = await rr.json();
    expect(t3.access_token).not.toBe(t2.access_token);
    const oldCall = await fetch(MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${t2.access_token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(oldCall.status).toBe(401);
    const fresh = await connect(t3.access_token);
    expect((await fresh.listTools()).tools.length).toBeGreaterThan(10);
    await fresh.close();

    // Reusing the rotated-out refresh token is theft: everything for the client is revoked.
    const reuse = await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: t2.refresh_token });
    expect(reuse.status).toBe(400);
    expect((await reuse.json()).error).toBe("invalid_grant");
    const afterReuse = await fetch(MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${t3.access_token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(afterReuse.status).toBe(401);
    const dead = await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: t3.refresh_token });
    expect(dead.status).toBe(400);
  });

  it("rejects a resource that is not this server", async () => {
    const res = await authorize({ challenge: pkce().challenge, resource: "https://other.example/api/mcp" }, "approve").catch(() => null);
    // The consent page itself redirects with invalid_target instead of rendering, so authorize() cannot parse a form.
    expect(res).toBeNull();
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: CALLBACK, response_type: "code", code_challenge: pkce().challenge, code_challenge_method: "S256", resource: "https://other.example/api/mcp" });
    const page = await fetch(`${BASE}/oauth/authorize?${q}`, { headers: { Cookie: `ob_session=${sessionCookie}` }, redirect: "manual" });
    expect([302, 303, 307]).toContain(page.status);
    expect(new URL(page.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");
  });

  it("revoke endpoint answers 200 and kills the token", async () => {
    const p = pkce();
    const res = await authorize({ challenge: p.challenge }, "approve");
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
    const t = await (await token({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: CALLBACK, code_verifier: p.verifier })).json();
    const rv = await fetch(`${BASE}/api/oauth/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ token: t.access_token, client_id: clientId }) });
    expect(rv.status).toBe(200);
    const call = await fetch(MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${t.access_token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(call.status).toBe(401);
  });
});

describe("rate limits (run last)", () => {
  it("registration is limited to 10 a minute per IP", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) {
      const r = await fetch(`${BASE}/api/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [CALLBACK] }) });
      codes.push(r.status);
      if (r.status === 429) expect(r.headers.get("retry-after")).toBeTruthy();
    }
    expect(codes).toContain(429);
  });

  it("MCP returns 429 with Retry-After after 60 requests a minute on one token", async () => {
    const seen: number[] = [];
    let retryAfter: string | null = null;
    for (let i = 0; i < 75; i++) {
      const r = await fetch(MCP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${STATIC_TOKEN}`, "MCP-Protocol-Version": "2025-06-18" },
        body: JSON.stringify({ jsonrpc: "2.0", id: i, method: "ping" }),
      });
      seen.push(r.status);
      if (r.status === 429) retryAfter = r.headers.get("retry-after");
      await r.text();
    }
    expect(seen).toContain(429);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(seen.filter((s) => s === 200).length).toBeLessThanOrEqual(60);
  });
});
