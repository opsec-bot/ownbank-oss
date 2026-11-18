// Screenshots every page of a running ownbank (demo data) at phone and desktop width, for design review.
// Usage: node scripts/shoot.mjs <outDir> [baseUrl] [sessionFile]
// Needs playwright importable (PLAYWRIGHT_PATH may point at a node_modules/playwright folder).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = process.argv[2] || "./shots";
const base = process.argv[3] || "http://localhost:3917";
const sessionFile = process.argv[4] || "./data/demo.db.session";
const pwPath = process.env.PLAYWRIGHT_PATH;
const { chromium } = pwPath ? await import(pathToFileURL(path.join(pwPath, "index.mjs")).href) : await import("playwright");

const routes = [
  ["dashboard", "/dashboard"],
  ["digest", "/digest"],
  ["growth", "/growth"],
  ["spending", "/spending"],
  ["spending-cat", "/spending?cat=Dining"],
  ["activity", "/transactions"],
  ["bills", "/bills"],
  ["settings", "/settings"],
  ["settings-bank", "/settings/bank"],
  ["settings-savings", "/settings/savings"],
  ["settings-budgets", "/settings/budgets"],
  ["settings-rules", "/settings/rules"],
  ["settings-rules-new", "/settings/rules?new=1"],
  ["settings-notifications", "/settings/notifications"],
  ["settings-wallets", "/settings/wallets"],
  ["settings-apps", "/settings/apps"],
  ["settings-security", "/settings/security"],
];
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const devices = [
  { name: "phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: "desktop", viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 },
];

fs.mkdirSync(outDir, { recursive: true });
const token = fs.readFileSync(sessionFile, "utf8").trim();
const browser = await chromium.launch();
for (const dev of devices) {
  if (process.env.DEVICE && process.env.DEVICE !== dev.name) continue;
  const { name, ...opts } = dev;
  // Logged out first: login page.
  const anon = await browser.newContext({ ...opts, colorScheme: "dark" });
  const ap = await anon.newPage();
  if (!only || only.has("login")) {
    await ap.goto(base + "/login", { waitUntil: "networkidle" });
    await ap.screenshot({ path: path.join(outDir, `${name}-login.png`), fullPage: true });
  }
  await anon.close();

  const ctx = await browser.newContext({ ...opts, colorScheme: "dark" });
  await ctx.addCookies([{ name: "ob_session", value: token, url: base }]);
  const page = await ctx.newPage();
  for (const [slug, url] of routes) {
    if (only && !only.has(slug)) continue;
    await page.goto(base + url, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    // The app scrolls inside AppFrame, so grow the viewport to the inner scroller's height for a full-length shot.
    const extra = await page.evaluate(() => {
      const el = [...document.querySelectorAll("div")].find((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight);
      return el ? el.scrollHeight - el.clientHeight : 0;
    });
    if (extra > 0) await page.setViewportSize({ width: opts.viewport.width, height: Math.min(opts.viewport.height + extra, 6000) });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, `${name}-${slug}.png`) });
    await page.setViewportSize(opts.viewport);
    console.log(`${name}-${slug}`);
  }
  await ctx.close();
}
await browser.close();
