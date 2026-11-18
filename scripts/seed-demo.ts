// Builds a demo database full of fake but believable data, for screenshots, design review and trying the app.
// Nothing here touches a real bank or wallet: transactions go through the normal sync pipeline from a fake provider.
// Usage: npm run seed:demo  (writes ./data/demo.db, prints the demo login)
//        DEMO_DB=./data/x.db npm run seed:demo
// Run the app on it with: DATABASE_PATH=./data/demo.db DISABLE_SYNC_TIMER=1 DISABLE_SCHEDULER=1 npm run dev
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

const file = process.env.DEMO_DB || "./data/demo.db";
process.env.DATABASE_PATH = file;
if (!process.env.TOKEN_ENC_KEY) process.env.TOKEN_ENC_KEY = randomBytes(32).toString("base64");

export const DEMO_EMAIL = "demo@ownbank.local";
export const DEMO_PASSWORD = "demo-password-123";

type Tx = { id: string; posted: number; transactedAt: number | null; amountCents: number; description: string; payee: string | null; memo: string | null; pending: boolean; mcc: string | null };

// Deterministic random so every run gives the same screenshots.
let seed = 42;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));

const DAY = 86400;

function buildTransactions(nowUnix: number): { checking: Tx[]; savings: Tx[] } {
  const checking: Tx[] = [];
  const savings: Tx[] = [];
  let n = 0;
  const add = (list: Tx[], daysAgo: number, cents: number, description: string, pending = false) => {
    const t = nowUnix - daysAgo * DAY - between(0, 6 * 3600);
    list.push({ id: `demo-${++n}`, posted: pending ? 0 : t, transactedAt: t, amountCents: cents, description, payee: null, memo: null, pending, mcc: null });
  };

  for (let d = 89; d >= 0; d--) {
    const date = new Date((nowUnix - d * DAY) * 1000);
    const dom = date.getUTCDate();
    const dow = date.getUTCDay();

    // Paycheck every other Friday.
    if (dow === 5 && Math.floor(d / 7) % 2 === 0) add(checking, d, 214_683, "NORTHWIND LABS PAYROLL DIRECT DEP");
    // Monthly bills.
    if (dom === 1) add(checking, d, -142_500, "MAPLE COURT APTS RENT ONLINE PMT");
    if (dom === 3) add(checking, d, -1_549, "NETFLIX.COM");
    if (dom === 6) add(checking, d, -1_199, "SPOTIFY USA");
    if (dom === 9) add(checking, d, -6_500, "T-MOBILE AUTOPAY");
    if (dom === 12) add(checking, d, -between(8_900, 13_400), "CITY POWER & LIGHT BILL PAY");
    if (dom === 14) add(checking, d, -11_840, "GEICO AUTO INSURANCE");
    if (dom === 18) add(checking, d, -2_999, "PLANET FITNESS CLUB FEES");
    if (dom === 20) add(checking, d, -2_000, "ANTHROPIC CLAUDE.AI SUBSCRIPTION");
    if (dom === 22) add(checking, d, -5_500, "SPECTRUM INTERNET");
    // Move money to savings twice a month.
    if (dom === 2 || dom === 16) {
      add(checking, d, -25_000, "ONLINE BANKING TRANSFER TO SAV 4471");
      add(savings, d, 25_000, "ONLINE BANKING TRANSFER FROM CHK 2208");
    }
    if (dom === 10) add(checking, d, -15_000, "COINBASE.COM PURCHASE");

    // Everyday spending.
    if (dow === 0 || dow === 3) add(checking, d, -between(4_800, 13_900), pick(["KROGER #512", "TRADER JOE'S #301", "WHOLE FOODS MKT", "ALDI 77104"]));
    if (rand() < 0.45) add(checking, d, -between(650, 2_400), pick(["STARBUCKS STORE 10234", "CHIPOTLE 2241", "CHICK-FIL-A #0198", "TACO BELL 31842", "SWEETGREEN UNION ST", "DOORDASH*THAI BASIL"]));
    if (dow === 2 || (dow === 6 && rand() < 0.6)) add(checking, d, -between(3_200, 5_800), pick(["SHELL OIL 57442", "CHEVRON 0091823", "EXXON MOBIL 4410"]));
    if (rand() < 0.12) add(checking, d, -between(1_500, 8_900), pick(["AMAZON.COM*2K4LM", "TARGET 00012345", "BEST BUY 00412"]));
    if (rand() < 0.06) add(checking, d, -between(1_200, 3_800), pick(["UBER *TRIP", "LYFT *RIDE"]));
    if (rand() < 0.05) add(checking, d, -between(1_800, 6_000), pick(["AMC THEATRES 2201", "STEAMGAMES.COM", "TICKETMASTER"]));
    if (rand() < 0.04) add(checking, d, -between(1_500, 4_500), pick(["CVS/PHARMACY #0412", "WALGREENS #5521"]));
    if (rand() < 0.03) add(checking, d, between(1_800, 4_200), "VENMO CASHOUT");
  }
  // Interest on savings, monthly.
  for (const d of [80, 50, 20]) add(savings, d, between(1_100, 1_500), "INTEREST EARNED");
  // Two pending charges today.
  add(checking, 0, -1_475, "SWEETGREEN UNION ST", true);
  add(checking, 0, -4_212, "SHELL OIL 57442", true);
  return { checking, savings };
}

async function main() {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });

  const { getDb, schema } = await import("../src/lib/db");
  const { hashPassword } = await import("../src/lib/auth/password");
  const { createSession } = await import("../src/lib/auth/session");
  const { encrypt } = await import("../src/lib/crypto");
  const { runSync } = await import("../src/lib/bank/sync");
  const { runPendingTasks } = await import("../src/lib/finance/recategorize");
  const { localDate } = await import("../src/lib/bank/normalize");

  const db = getDb();
  const now = Date.now();
  const nowUnix = Math.floor(now / 1000);
  runPendingTasks(db, now);

  const user = db
    .insert(schema.users)
    .values({ email: DEMO_EMAIL, passwordHash: await hashPassword(DEMO_PASSWORD), createdAt: now })
    .returning({ id: schema.users.id })
    .get();

  db.insert(schema.connections)
    .values({ provider: "simplefin", providerConnectionId: "demo", institutionName: "Demo Credit Union", accessTokenEnc: encrypt("https://demo.invalid/simplefin"), createdAt: now })
    .run();

  // Savings settings and wallets before the sync, so the pipeline sees them.
  db.insert(schema.settings).values({ id: 1 }).onConflictDoNothing().run();
  db.insert(schema.savingsGoal)
    .values({ id: 1, name: "Emergency fund", targetCents: 1_000_000, targetDate: localDate(nowUnix + 240 * DAY), counts: "all_savings", createdAt: now })
    .run();

  const { checking, savings } = buildTransactions(nowUnix);
  const accounts = [
    { id: "demo-chk", name: "Everyday Checking - 2208", currency: "USD", balanceCents: 384_217, availableBalanceCents: 378_530, balanceDate: nowUnix, orgName: "Demo Credit Union", transactions: checking },
    { id: "demo-sav", name: "High Yield Savings - 4471", currency: "USD", balanceCents: 612_940, availableBalanceCents: 612_940, balanceDate: nowUnix, orgName: "Demo Credit Union", transactions: savings },
  ];

  const out = await runSync("manual", {
    db,
    now,
    backfill: true,
    fetchAccounts: async (_url: string, opts: { startDate: number; endDate: number }) => ({
      connectionNames: ["Demo Credit Union"],
      accounts: accounts.map((a) => ({
        ...a,
        transactions: a.transactions.filter((t) => {
          const at = t.posted || t.transactedAt || 0;
          return at >= opts.startDate && at <= opts.endDate;
        }),
      })),
    }),
    refreshWallets: async (d: typeof db) => {
      const rows = [
        { address: "DemoSav1ngsWa11et111111111111111111111111111", label: "Savings", role: "savings" as const, sol: 2_412_00, stable: 1_850_00, top: [{ symbol: "USDC", usdCents: 1_850_00 }, { symbol: "SOL", usdCents: 2_412_00 }] },
        { address: "DemoTrad1ngWa11et11111111111111111111111111", label: "Trading", role: "trading" as const, sol: 312_00, stable: 0, top: [{ symbol: "SOL", usdCents: 312_00 }] },
      ];
      for (const w of rows) {
        d.insert(schema.cryptoWallets)
          .values({
            address: w.address,
            label: w.label,
            role: w.role,
            solLamports: Math.round((w.sol / 100 / 140) * 1e9),
            solUsdCents: w.sol,
            tokensUsdCents: w.stable,
            totalUsdCents: w.sol + w.stable,
            stableUsdCents: w.stable,
            volatileUsdCents: w.sol,
            topHoldings: JSON.stringify(w.top),
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
      }
    },
  } as never);
  if (!out.ok) throw new Error(`demo sync failed: ${JSON.stringify(out)}`);

  // 90 days of net worth history, drifting up to today's real snapshot.
  const today = db.select().from(schema.netWorthSnapshots).where(eq(schema.netWorthSnapshots.day, localDate(nowUnix))).get();
  if (today) {
    for (let d = 90; d >= 1; d--) {
      const f = 1 - d * 0.0022 + Math.sin(d / 5) * 0.004;
      db.insert(schema.netWorthSnapshots)
        .values({
          day: localDate(nowUnix - d * DAY),
          bankCents: Math.round(today.bankCents * f),
          cryptoStableCents: Math.round(today.cryptoStableCents * (1 - d * 0.003)),
          cryptoVolatileCents: Math.round(today.cryptoVolatileCents * (f + Math.sin(d / 3) * 0.03)),
          cryptoTradingCents: today.cryptoTradingCents,
          totalCents: Math.round(today.totalCents * f),
        })
        .onConflictDoNothing()
        .run();
    }
  }

  // Budgets on the main expense categories.
  const cats = new Map(db.select().from(schema.categories).all().map((c) => [c.name, c.id]));
  const budgets: [string, number][] = [["Groceries", 450_00], ["Dining", 300_00], ["Transport", 220_00], ["Shopping", 150_00], ["Subscriptions", 80_00]];
  for (const [name, cents] of budgets) {
    const id = cats.get(name);
    if (id) db.insert(schema.budgets).values({ categoryId: id, monthlyLimitCents: cents, createdAt: now, updatedAt: now }).run();
  }

  // A Claude-style digest for today (verdict + actions format).
  db.insert(schema.digests)
    .values({
      day: localDate(nowUnix),
      source: "claude",
      bodyMd: "# You're on track. Dining is the one to watch.\n- Dining is at 82% of budget with 12 days left. Cook twice this week.\n- Rent clears on the 1st. Checking covers it with room to spare.\n- Payday Friday: move $430 to savings to stay on pace for the emergency fund.",
      createdAt: now,
    })
    .onConflictDoNothing()
    .run();

  const session = createSession(user.id, "demo", db, now);
  fs.writeFileSync(file + ".session", session.token);
  console.log(`demo db: ${file}`);
  console.log(`login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`session token written to ${file}.session`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
