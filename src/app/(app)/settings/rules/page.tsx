import { BackHeader, ListGroup, ListRow } from "@/components/list";
import { dangerText } from "@/components/form";
import Link from "next/link";
import { Notice, card, primaryBtn, smallBtn } from "@/components/ui";
import { requireSession } from "@/lib/auth/request";
import { getDb, schema } from "@/lib/db";
import { ruleMatchCounts } from "@/lib/finance/recategorize";
import { createRuleAction, deleteRuleAction, toggleRuleAction, updateRuleAction } from "./actions";
import { RuleForm } from "./rule-form";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function RulesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession();
  const sp = await searchParams;
  const db = getDb();
  const categories = db.select().from(schema.categories).orderBy(schema.categories.name).all();
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const all = db.select().from(schema.rules).all();
  const showDefaults = first(sp.defaults) === "1";
  const byOrder = (a: (typeof all)[number], b: (typeof all)[number]) => b.priority - a.priority || a.id - b.id;
  const userRules = all.filter((r) => !r.isDefault).sort(byOrder);
  const defaults = all.filter((r) => r.isDefault).sort(byOrder);
  const visible = showDefaults ? [...userRules, ...defaults] : userRules;
  const counts = ruleMatchCounts(db, visible);

  const editId = Number(first(sp.edit)) || null;
  const editing = editId ? all.find((r) => r.id === editId) : undefined;
  const creating = first(sp.new) === "1";
  const prefillCat = Number(first(sp.cat)) || null;

  return (
    <main className="flex flex-col gap-4">
      <BackHeader title="Rules" />
      <p className="text-xs text-muted">First match wins: yours first, then higher priority. Hand-set transactions are kept.</p>
      <Notice ok={first(sp.ok)} e={first(sp.e)} />

      {editing ? (
        <section className={card}>
          <h2 className="text-sm font-medium">Edit rule</h2>
          <RuleForm
            key={editing.id}
            action={updateRuleAction}
            categories={categories}
            submitLabel="Save changes"
            cancelHref={`/settings/rules${editing.isDefault ? "?defaults=1" : ""}`}
            initial={{
              id: editing.id,
              pattern: editing.pattern,
              matchType: editing.matchType,
              field: editing.field,
              categoryId: editing.categoryId,
              priority: editing.priority,
              direction: editing.direction,
            }}
          />
        </section>
      ) : creating ? (
        <section className={card}>
          <h2 className="text-sm font-medium">New rule</h2>
          <RuleForm
            action={createRuleAction}
            categories={categories}
            submitLabel="Create rule"
            cancelHref="/settings/rules"
            initial={{ pattern: first(sp.pattern).slice(0, 200), matchType: "contains", field: "any", categoryId: prefillCat, priority: 0, direction: first(sp.dir) === "in" ? "in" : "out" }}
          />
        </section>
      ) : (
        <Link href="/settings/rules?new=1" className={primaryBtn}>
          New rule
        </Link>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-sm font-medium">Your rules ({userRules.length})</h2>
        {userRules.length === 0 && <p className="text-sm text-muted">None yet. The built-in rules below cover common merchants.</p>}
        <RuleList rules={userRules} counts={counts} catName={catName} />
      </section>

      <ListGroup>
        <ListRow
          href={showDefaults ? "/settings/rules" : "/settings/rules?defaults=1"}
          label={`Built-in rules (${defaults.length})`}
          value={showDefaults ? "Hide" : "Show"}
        />
      </ListGroup>
      {showDefaults && <RuleList rules={defaults} counts={counts} catName={catName} />}
    </main>
  );
}

function RuleList({
  rules,
  counts,
  catName,
}: {
  rules: {
    id: number;
    pattern: string;
    matchType: string;
    field: string;
    categoryId: number;
    priority: number;
    enabled: boolean;
    isDefault: boolean;
    direction: string;
  }[];
  counts: Map<number, number>;
  catName: Map<number, string>;
}) {
  if (rules.length === 0) return null;
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl bg-surface">
      {rules.map((r) => (
        <li key={r.id} className={"flex flex-col gap-2 px-4 py-3 " + (r.enabled ? "" : "opacity-60")}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-all font-mono text-sm">{r.pattern}</p>
              <p className="text-xs text-muted">
                {r.direction === "any" ? "in or out" : r.direction === "in" ? "money in" : "money out"} · {r.matchType}
                {r.field === "any" ? "" : ` in ${r.field === "counterparty" ? "payee" : "description"}`} &rarr; {catName.get(r.categoryId) ?? "?"}
                {r.priority !== 0 && !r.isDefault ? ` · priority ${r.priority}` : ""}
              </p>
            </div>
            <p className="shrink-0 text-sm tabular-nums text-muted">{counts.get(r.id) ?? 0} matches</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form action={toggleRuleAction}>
              <input type="hidden" name="id" value={r.id} />
              <button type="submit" className={smallBtn} aria-pressed={r.enabled}>
                {r.enabled ? "On" : "Off"}
              </button>
            </form>
            <Link href={`/settings/rules?edit=${r.id}`} className={smallBtn}>
              Edit
            </Link>
            <form action={deleteRuleAction} className="ml-auto">
              <input type="hidden" name="id" value={r.id} />
              <button type="submit" className={dangerText}>
                Delete
              </button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
}
