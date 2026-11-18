"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// 24px stroke icons, drawn inline so nothing loads from outside.
const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const TABS = [
  { href: "/dashboard", label: "Home", icon: icon(<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />) },
  {
    href: "/spending",
    label: "Spending",
    icon: icon(
      <>
        <path d="M21 12a9 9 0 1 1-9-9v9z" />
        <path d="M14 3.3A9 9 0 0 1 20.7 10H14z" />
      </>,
    ),
  },
  {
    href: "/transactions",
    label: "Activity",
    icon: icon(<path d="M4 6h16M4 12h16M4 18h10" />),
  },
  {
    href: "/bills",
    label: "Bills",
    icon: icon(
      <>
        <rect x="4" y="5" width="16" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </>,
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: icon(
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </>,
    ),
  },
];

function isActive(path: string, href: string): boolean {
  return path === href || path.startsWith(href + "/") || (href === "/dashboard" && (path === "/digest" || path === "/growth"));
}

// Desktop (lg and up): vertical list of the same destinations.
export function SideNav() {
  const path = usePathname() ?? "";
  return (
    <aside className="hidden w-[220px] shrink-0 flex-col gap-6 border-r border-border bg-bg px-3 pt-8 lg:flex">
      <p className="px-3 text-lg font-semibold tracking-tight">ownbank</p>
      <nav aria-label="Main">
        <ul className="flex flex-col gap-1">
          {TABS.map((t) => {
            const active = isActive(path, t.href);
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={"flex items-center gap-3 rounded-xl px-3 py-2.5 " + (active ? "bg-surface text-text" : "text-muted hover:text-text")}
                >
                  {t.icon}
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

export function TabBar() {
  const path = usePathname() ?? "";
  return (
    <nav aria-label="Main" className="shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto grid max-w-3xl grid-cols-5">
        {TABS.map((t) => {
          const active = isActive(path, t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 pt-1.5 text-[11px] " +
                  (active ? "font-medium text-accent" : "text-muted active:text-text")
                }
              >
                {t.icon}
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
