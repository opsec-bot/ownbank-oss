"use client";

import { useActionState } from "react";
import { Field } from "@/components/form";
import { field, primaryBtn } from "@/components/ui";
import { confirmSetupAction, regenerateAction, type CodesState } from "./actions";

const primary = primaryBtn + " disabled:opacity-60";

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">Recovery codes. Save them now, they are shown once.</p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-base">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <p className="text-xs text-muted">Each works one time if you lose your authenticator. Store them somewhere safe.</p>
    </div>
  );
}

export function ConfirmForm() {
  const [state, action, pending] = useActionState<CodesState, FormData>(confirmSetupAction, {});
  if (state.codes) return <RecoveryCodes codes={state.codes} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Code from the app">
        <input name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} className={field} />
      </Field>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={primary}>
        Confirm and turn on
      </button>
    </form>
  );
}

export function RegenerateForm() {
  const [state, action, pending] = useActionState<CodesState, FormData>(regenerateAction, {});
  if (state.codes) return <RecoveryCodes codes={state.codes} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Current code (the old recovery codes stop working)">
        <input name="code" autoComplete="one-time-code" required maxLength={20} className={field} />
      </Field>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={primary}>
        New recovery codes
      </button>
    </form>
  );
}
