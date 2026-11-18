import { eq } from "drizzle-orm";
import { localDate, merchantKey } from "@/lib/bank/normalize";
import { getDb, schema, type DB } from "@/lib/db";
import { categorize, matchesRule, type RuleRow } from "./categorize";
import { rebuildRecurring } from "./recurring";

function loadRules(db: DB): RuleRow[] {
  return db.select().from(schema.rules).all();
}

// Re-runs categorization over every non-manual transaction. Returns how many rows changed.
export function recategorizeAll(db: DB = getDb()): { checked: number; changed: number } {
  const cats = db.select().from(schema.categories).all();
  const byName = new Map(cats.map((c) => [c.name, c.id]));
  const rules = loadRules(db);
  const rows = db.select().from(schema.transactions).all();
  let checked = 0;
  let changed = 0;
  const now = Date.now();
  db.transaction((tx) => {
    for (const t of rows) {
      if (t.categorySource === "manual") continue;
      checked++;
      const cat = categorize(
        { description: t.description, counterparty: t.counterparty, amountCents: t.amountCents, mcc: t.providerCategory },
        rules,
        byName,
      );
      if (cat.categoryId === t.categoryId && cat.source === t.categorySource) continue;
      tx.update(schema.transactions)
        .set({ categoryId: cat.categoryId, categorySource: cat.source, updatedAt: now })
        .where(eq(schema.transactions.id, t.id))
        .run();
      changed++;
    }
  });
  return { checked, changed };
}

// Call after any rule or category change: recategorize, then rebuild recurring (transfer exclusion depends on it).
export function applyRuleChange(db: DB = getDb(), now = Date.now()): { checked: number; changed: number } {
  const out = recategorizeAll(db);
  rebuildRecurring(db, localDate(Math.floor(now / 1000)));
  return out;
}

// Number of transactions a rule would match (manual rows excluded, since the rule cannot touch them).
// `sample` returns up to 5 distinct merchant keys for the live preview.
export function previewRule(
  db: DB,
  rule: Omit<RuleRow, "id" | "enabled">,
): { count: number; sample: string[] } {
  const probe: RuleRow = { ...rule, id: 0, enabled: true };
  const rows = db.select().from(schema.transactions).all();
  let count = 0;
  const sample = new Set<string>();
  for (const t of rows) {
    if (t.categorySource === "manual") continue;
    if (!matchesRule(probe, t)) continue;
    count++;
    if (sample.size < 5 && t.merchantKey) sample.add(t.merchantKey);
  }
  return { count, sample: [...sample] };
}

// Per-rule match counts for the rules list, one pass over the transactions.
export function ruleMatchCounts(db: DB, rules: RuleRow[]): Map<number, number> {
  const rows = db.select().from(schema.transactions).all();
  const out = new Map<number, number>();
  for (const r of rules) {
    let n = 0;
    for (const t of rows) if (matchesRule(r, t)) n++;
    out.set(r.id, n);
  }
  return out;
}

// Recomputes merchant_key for every transaction (after a normalizer change). Ignored recurring rows follow their
// merchant to the new key so "not a bill" survives. Does not touch categories or rules.
export function rekeyAll(db: DB = getDb()): { checked: number; changed: number } {
  const rows = db.select().from(schema.transactions).all();
  const remap = new Map<string, string>();
  let changed = 0;
  db.transaction((tx) => {
    for (const t of rows) {
      const key = merchantKey(t.counterparty, t.description);
      if (key === t.merchantKey) continue;
      tx.update(schema.transactions).set({ merchantKey: key }).where(eq(schema.transactions.id, t.id)).run();
      if (t.merchantKey) remap.set(t.merchantKey, key);
      changed++;
    }
    for (const r of tx.select().from(schema.recurringCharges).all()) {
      const next = remap.get(r.merchantKey);
      if (!next || r.manual) continue;
      if (!r.ignored) continue; // detected rows are rebuilt from scratch
      const clash = tx.select().from(schema.recurringCharges).where(eq(schema.recurringCharges.merchantKey, next)).get();
      if (!clash) tx.update(schema.recurringCharges).set({ merchantKey: next }).where(eq(schema.recurringCharges.merchantKey, r.merchantKey)).run();
    }
  });
  return { checked: rows.length, changed };
}

// One-time data tasks queued by migrations (flag rows in app_state). Safe to call on every start.
export function runPendingTasks(db: DB = getDb(), now = Date.now()): string[] {
  const done: string[] = [];
  const flag = db.select().from(schema.appState).where(eq(schema.appState.key, "needs_recategorize")).get();
  if (flag?.value === "1") {
    applyRuleChange(db, now);
    db.update(schema.appState).set({ value: "0" }).where(eq(schema.appState.key, "needs_recategorize")).run();
    done.push("recategorize");
  }
  const rekey = db.select().from(schema.appState).where(eq(schema.appState.key, "needs_rekey")).get();
  if (rekey?.value === "1") {
    rekeyAll(db);
    rebuildRecurring(db, localDate(Math.floor(now / 1000)));
    db.update(schema.appState).set({ value: "0" }).where(eq(schema.appState.key, "needs_rekey")).run();
    done.push("rekey");
  }
  return done;
}
