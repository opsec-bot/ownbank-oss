import type { ReactNode } from "react";
import { parseMarkdown, type Inline } from "@/lib/finance/markdown";
import { formatCents } from "@/lib/finance/networth";

// Shared class strings so every page looks the same.
export const field =
  "h-11 w-full rounded-lg border border-border bg-bg px-3 text-base text-text outline-none focus:border-accent";
export const textareaField =
  "w-full rounded-lg border border-border bg-bg px-3 py-3 text-base text-text outline-none focus:border-accent";
export const primaryBtn = "rounded-lg bg-accent px-4 py-3 text-center font-medium text-accent-fg active:opacity-80 sm:w-auto sm:self-start sm:px-5";
export const secondaryBtn = "rounded-lg border border-border bg-surface px-4 py-3 text-center text-text active:bg-bg sm:w-auto sm:self-start sm:px-5";
export const smallBtn = "rounded-lg border border-border px-3 py-2 text-sm text-text active:bg-bg";
export const card = "flex flex-col gap-3 rounded-2xl bg-surface p-4";

// Metric tile: big number, small label, optional muted line under it.
export function Tile({
  label,
  value,
  sub,
  danger,
  children,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  danger?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={"text-2xl font-semibold tabular-nums " + (danger ? "text-danger" : "")}>{value}</p>
      {sub ? <p className="text-xs text-muted">{sub}</p> : null}
      {children}
    </div>
  );
}

// Label left, number right, optional muted line under the label. Use inside a <dl>.
export function Row({ label, value, sub, danger }: { label: string; value: string; sub?: ReactNode; danger?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="min-w-0">
        <span className="block text-sm">{label}</span>
        {sub ? <span className="block text-xs text-muted">{sub}</span> : null}
      </dt>
      <dd className={"shrink-0 font-semibold tabular-nums " + (danger ? "text-danger" : "")}>{value}</dd>
    </div>
  );
}

// "discount tire" -> "Discount Tire". Leaves tokens that already have capitals alone.
export function titleCase(s: string): string {
  return s.replace(/(^|[\s\-/(])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

export function signed(cents: number | null): string {
  if (cents === null) return "n/a";
  return `${cents >= 0 ? "+" : "-"}${formatCents(Math.abs(cents))}`;
}

export function Notice({ ok, e }: { ok?: string; e?: string }) {
  return (
    <>
      {ok && <p className="rounded-lg border border-border bg-surface p-3 text-sm">{ok}</p>}
      {e && (
        <p role="alert" className="rounded-lg border border-danger p-3 text-sm text-danger">
          {e}
        </p>
      )}
    </>
  );
}

function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.code ? (
          <code key={i} className="rounded bg-bg px-1 text-sm">
            {p.text}
          </code>
        ) : p.bold ? (
          <strong key={i}>{p.text}</strong>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

// Renders parsed markdown as plain React text nodes. No HTML is ever injected.
export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="flex flex-col gap-3 text-base leading-relaxed">
      {blocks.map((b, i) => {
        if (b.type === "heading") {
          const cls = b.level === 1 ? "text-lg font-semibold" : "font-semibold";
          return (
            <p key={i} className={cls}>
              <InlineText parts={b.inline} />
            </p>
          );
        }
        if (b.type === "list") {
          return (
            <ul key={i} className="flex flex-col gap-1">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-2" style={{ paddingLeft: it.depth * 16 }}>
                  <span className="text-muted">-</span>
                  <span>
                    <InlineText parts={it.inline} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            <InlineText parts={b.inline} />
          </p>
        );
      })}
    </div>
  );
}
