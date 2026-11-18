"use client";

import { useActionState } from "react";
import { Field } from "@/components/form";
import { field, primaryBtn } from "@/components/ui";
import { setupAction, type SetupState } from "./actions";

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(setupAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Setup code (printed in the server log)">
        <input name="code" required autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX" className={field + " tracking-widest"} />
      </Field>
      <Field label="Email">
        <input name="email" type="email" autoComplete="username" required className={field} />
      </Field>
      <Field label="Password (at least 12 characters)">
        <input name="password" type="password" autoComplete="new-password" required minLength={12} className={field} />
      </Field>
      <Field label="Confirm password">
        <input name="confirm" type="password" autoComplete="new-password" required minLength={12} className={field} />
      </Field>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={primaryBtn + " disabled:opacity-60"}>
        {pending ? "Setting up..." : "Create account"}
      </button>
    </form>
  );
}
