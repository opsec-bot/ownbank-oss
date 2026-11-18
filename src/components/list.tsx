import Link from "next/link";
import type { ReactNode } from "react";

// Apple-Settings style grouped lists: icon tile, label, value, chevron; tapping a row opens its own page.

const paths: Record<string, ReactNode> = {
  bank: (
    <>
      <path d="M3 10l9-6 9 6" />
      <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
    </>
  ),
  piggy: (
    <>
      <path d="M5 11a7 6 0 0 1 12-3h2l-1 3 2 1v3h-2l-1 2v2h-3v-1.5a8 8 0 0 1-3 0V19H8v-2.3A6 6 0 0 1 5 11z" />
      <path d="M15 10.5h.01" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.8" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v4M15 3v4" />
      <path d="M7 7h10v4a5 5 0 0 1-10 0z" />
      <path d="M12 16v5" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 9h15a3 3 0 0 1 3 3v0M16 13.5h.01" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12V4h8l9 9-8 8z" />
      <path d="M7.5 8h.01" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 17a8 8 0 1 1 16 0" />
      <path d="M12 17l4-5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  trend: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </>
  ),
  flow: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  coin: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.7 2.5 1.7c0 2.3-5 1.3-5 3.8 0 1 1 1.8 2.5 1.8s2.5-.6 2.5-1.6" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

// Neutral tile (one-accent rule: no rainbow icons). Danger only for something broken.
export function IconTile({ name, danger }: { name: IconName; danger?: boolean }) {
  return (
    <span className={"flex size-[30px] shrink-0 items-center justify-center rounded-lg " + (danger ? "bg-danger text-bg" : "bg-bg text-text")}>
      <Icon name={name} />
    </span>
  );
}

export function ListGroup({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      {title ? <h2 className="px-1 text-sm font-semibold">{title}</h2> : null}
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl bg-surface">{children}</ul>
      {footer ? <p className="px-1 text-xs text-muted">{footer}</p> : null}
    </section>
  );
}

export function ListRow({
  href,
  icon,
  label,
  value,
  sub,
  danger,
  broken,
  muted,
}: {
  href?: string;
  icon?: IconName;
  label: ReactNode;
  value?: ReactNode;
  sub?: ReactNode;
  danger?: boolean; // red value (e.g. a negative number)
  broken?: boolean; // red icon tile too, for something that needs fixing
  muted?: boolean;
}) {
  const inner = (
    <>
      {icon ? <IconTile name={icon} danger={broken} /> : null}
      <span className="min-w-0 flex-1">
        <span className={"block truncate " + (muted ? "text-muted" : "")}>{label}</span>
        {sub ? <span className="block truncate text-xs text-muted tabular-nums">{sub}</span> : null}
      </span>
      {value !== undefined ? (
        <span className={"shrink-0 text-right tabular-nums " + (danger ? "text-danger" : href ? "text-muted" : "font-semibold")}>{value}</span>
      ) : null}
      {href ? (
        <span aria-hidden="true" className="-mr-1 shrink-0 text-xl leading-none text-muted">
          &rsaquo;
        </span>
      ) : null}
    </>
  );
  const cls = "flex min-h-12 items-center gap-3 px-4 py-2.5";
  return (
    <li>
      {href ? (
        <Link href={href} className={cls + " active:bg-bg"}>
          {inner}
        </Link>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </li>
  );
}

// Sub-page header: small back link above the large title.
export function BackHeader({ title, back = { href: "/settings", label: "Settings" }, right }: { title: string; back?: { href: string; label: string }; right?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Link href={back.href} className="-ml-1 flex w-fit items-center gap-0.5 py-1 text-accent">
        <span aria-hidden="true" className="text-xl leading-none">
          &lsaquo;
        </span>
        {back.label}
      </Link>
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-[28px] font-bold tracking-tight">{title}</h1>
        {right}
      </div>
    </div>
  );
}
