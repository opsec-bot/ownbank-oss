"use client";

import { useActionState } from "react";
import { verifyAction, type LoginState } from "../actions";

const field =
  "w-full rounded-lg border border-border bg-surface px-3 py-3 text-center text-xl tracking-widest text-text outline-none focus:border-accent";

export function VerifyForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(verifyAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-muted">
        6-digit code from your authenticator, or a recovery code
        <input
          name="code"
          type="text"
          inputMode="text"
          autoComplete="one-time-code"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          autoFocus
          maxLength={20}
          className={field}
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-3 font-medium text-accent-fg disabled:opacity-60"
      >
        {pending ? "Checking..." : "Verify"}
      </button>
      <a href="/login" className="text-center text-sm text-muted underline">
        Start over
      </a>
    </form>
  );
}
