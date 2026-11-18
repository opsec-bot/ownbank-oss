"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Field, summaryCls } from "@/components/form";
import { field, primaryBtn } from "@/components/ui";
import { previewRuleAction, type PreviewResult } from "./actions";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  categories: { id: number; name: string }[];
  initial: { id?: number; pattern: string; matchType: string; field: string; categoryId: number | null; priority: number; direction: string };
  submitLabel: string;
  cancelHref?: string;
};

// Rule editor with a live "matches N transactions" preview (read only server action, debounced).
export function RuleForm({ action, categories, initial, submitLabel, cancelHref }: Props) {
  const [pattern, setPattern] = useState(initial.pattern);
  const [matchType, setMatchType] = useState(initial.matchType);
  const [fieldName, setFieldName] = useState(initial.field);
  const [direction, setDirection] = useState(initial.direction);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  useEffect(() => {
    if (!pattern.trim()) return;
    let cancelled = false;
    const t = setTimeout(() => {
      previewRuleAction({ pattern, matchType, field: fieldName, direction })
        .then((r) => {
          if (!cancelled) setPreview(r);
        })
        .catch(() => {
          if (!cancelled) setPreview({ count: 0, sample: [], error: "Preview failed." });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pattern, matchType, fieldName, direction]);

  const shown = pattern.trim() ? preview : null;

  return (
    <form action={action} className="flex flex-col gap-3">
      {initial.id !== undefined && <input type="hidden" name="id" value={initial.id} />}
      <div className="flex flex-col gap-1.5">
        <Field label="Text to look for">
          <input
            name="pattern"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            required
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            className={field}
          />
        </Field>
        <div aria-live="polite">
          {shown?.error ? (
            <p className="text-sm text-danger">{shown.error}</p>
          ) : shown ? (
            <p className="text-sm">
              Matches <span className="font-semibold">{shown.count}</span> transaction{shown.count === 1 ? "" : "s"}
              {shown.sample.length > 0 && <span className="text-muted">: {shown.sample.join(", ")}</span>}
            </p>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Match
          <select name="matchType" value={matchType} onChange={(e) => setMatchType(e.target.value)} className={field}>
            <option value="contains">Contains</option>
            <option value="equals">Equals</option>
            <option value="regex">Regex</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Look in
          <select name="field" value={fieldName} onChange={(e) => setFieldName(e.target.value)} className={field}>
            <option value="any">Name or payee</option>
            <option value="description">Description</option>
            <option value="counterparty">Payee</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Applies to
          <select name="direction" value={direction} onChange={(e) => setDirection(e.target.value)} className={field}>
            <option value="out">Money out</option>
            <option value="in">Money in</option>
            <option value="any">Both</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Category
          <select name="categoryId" defaultValue={initial.categoryId ?? ""} required className={field}>
            <option value="" disabled>
              Pick one
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details className="group/more">
        <summary className={summaryCls + " flex items-center gap-1 self-start py-2 text-sm text-accent"}>
          More options
          <span aria-hidden="true" className="inline-block transition-transform group-open/more:rotate-90">›</span>
        </summary>
        <div className="pt-2">
          <Field label="Priority (higher runs first)">
            <input name="priority" type="number" defaultValue={initial.priority} min={-50} max={1000} className={field} />
          </Field>
        </div>
      </details>
      <div className="flex items-center gap-4">
        <button type="submit" className={primaryBtn}>
          {submitLabel}
        </button>
        {cancelHref && (
          <Link href={cancelHref} className="py-2 text-sm text-muted active:opacity-70">
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}
