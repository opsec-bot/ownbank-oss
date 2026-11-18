import Link from "next/link";
import type { ReactNode } from "react";
import { field } from "@/components/ui";

// Small shared form pieces: labelled field, adorned inputs, iOS switch, quiet destructive/cancel actions.

// Cents to the text shown in a money input: "450" for whole dollars, "450.50" otherwise.
export function moneyValue(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

export const labelCls = "flex flex-col gap-1.5 text-sm text-muted";

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className={labelCls}>
      {label}
      {children}
    </label>
  );
}

type Adorned = {
  name: string;
  defaultValue?: string | number;
  placeholder?: string;
  required?: boolean;
  label?: string;
  min?: number;
  max?: number;
};

// Dollar amount with a muted "$" inside the field. Pass defaultCents to show whole dollars without ".00".
export function MoneyInput({ name, defaultCents, defaultValue, placeholder, required, label }: Adorned & { defaultCents?: number }) {
  return (
    <span className="relative block">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">
        $
      </span>
      <input
        name={name}
        inputMode="decimal"
        autoComplete="off"
        defaultValue={defaultCents !== undefined ? moneyValue(defaultCents) : defaultValue}
        placeholder={placeholder}
        required={required}
        aria-label={label}
        className={field + " pl-7 tabular-nums"}
      />
    </span>
  );
}

export function PercentInput({ name, defaultValue, placeholder, required, label, min = 0, max = 100 }: Adorned) {
  return (
    <span className="relative block">
      <input
        name={name}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        aria-label={label}
        className={field + " pr-8 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"}
      />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted">
        %
      </span>
    </span>
  );
}

// iOS-style switch on a real checkbox, so forms and keyboards work unchanged.
export function Toggle({ name, defaultChecked, label, value }: { name: string; defaultChecked?: boolean; label?: string; value?: string }) {
  return (
    <input
      type="checkbox"
      name={name}
      value={value}
      defaultChecked={defaultChecked}
      aria-label={label}
      className="relative h-[26px] w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-border outline-none transition-colors before:absolute before:left-0.5 before:top-0.5 before:size-[22px] before:rounded-full before:bg-text before:transition-transform checked:bg-accent checked:before:translate-x-[18px] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    />
  );
}

// A row inside a ListGroup: label on the left, toggle on the right.
export function ToggleRow({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <li>
      <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-2.5">
        <span>{label}</span>
        <Toggle name={name} defaultChecked={defaultChecked} />
      </label>
    </li>
  );
}

export const dangerText = "self-start py-2 text-sm text-danger active:opacity-70";

// Small left-aligned destructive text button, for the bottom of a card or section.
export function DangerButton({ children }: { children: ReactNode }) {
  return (
    <button type="submit" className={dangerText}>
      {children}
    </button>
  );
}

export function CancelLink({ href, children = "Cancel" }: { href: string; children?: ReactNode }) {
  return (
    <Link href={href} className="py-2 text-sm text-muted active:opacity-70">
      {children}
    </Link>
  );
}

// Primary button with its quiet cancel link beside it.
export function FormActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-4">{children}</div>;
}

// Row-style disclosure summary (no marker) shared by expandable rows.
export const summaryCls = "list-none [&::-webkit-details-marker]:hidden cursor-pointer";
