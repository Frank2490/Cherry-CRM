"use client";

import { useActionState } from "react";
import { logout, type AuthActionState } from "@/app/actions/auth";

const initialState: AuthActionState = {};

export function LogoutButton() {
  const [state, formAction, pending] = useActionState(logout, initialState);

  return (
    <form action={formAction} aria-busy={pending} className="relative">
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 whitespace-nowrap rounded-lg px-2 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none sm:px-3 sm:text-sm"
      >
        {pending ? "Wylogowywanie…" : "Wyloguj się"}
      </button>
      {state.message && (
        <p role="alert" className="absolute right-0 top-full z-20 mt-2 w-60 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-900 shadow-sm">
          {state.message}
        </p>
      )}
    </form>
  );
}
