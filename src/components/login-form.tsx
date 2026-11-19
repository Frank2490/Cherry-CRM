"use client";

import { useActionState } from "react";
import { login, type AuthActionState } from "@/app/actions/auth";

const initialState: AuthActionState = {};
const inputClassName =
  "mt-2 min-h-12 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-[#734353] focus:ring-2 focus:ring-[#734353]/15 disabled:bg-zinc-50 aria-invalid:border-red-700";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} noValidate aria-busy={pending} className="mt-8 space-y-5">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="text-sm font-medium text-zinc-800">
          Adres e-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          defaultValue={state.email ?? ""}
          disabled={pending}
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
          className={inputClassName}
        />
        {state.fieldErrors?.email && (
          <p id="email-error" role="alert" className="mt-2 text-sm text-red-800">
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="text-sm font-medium text-zinc-800">
          Hasło
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={state.fieldErrors?.password ? "password-error" : undefined}
          className={inputClassName}
        />
        {state.fieldErrors?.password && (
          <p id="password-error" role="alert" className="mt-2 text-sm text-red-800">
            {state.fieldErrors.password}
          </p>
        )}
      </div>

      {state.message && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm leading-6 text-red-900">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-[#542b39] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#43222d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 disabled:cursor-wait disabled:opacity-70 motion-reduce:transition-none"
      >
        {pending ? "Logowanie…" : "Zaloguj się"}
      </button>
    </form>
  );
}
