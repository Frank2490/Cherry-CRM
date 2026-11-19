import type { Metadata } from "next";
import { FollowUpsList } from "@/components/follow-ups/follow-ups-list";
import { getFollowUpLeads } from "@/lib/leads/follow-up-queries";
import { getTodayInWarsaw } from "@/lib/leads/pipeline";

export const metadata: Metadata = { title: "Follow-upy" };

export default async function FollowUpsPage() {
  const result = await getFollowUpLeads();
  return (
    <div className="min-w-0">
      <header className="mb-8 sm:mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-[34px]">
          Follow-upy
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-600 sm:text-base">
          Kontakty na dziś, zaległe rozmowy i kolejne kroki w jednym miejscu.
        </p>
      </header>
      {result.ok ? (
        <FollowUpsList leads={result.leads} initialToday={getTodayInWarsaw()} />
      ) : (
        <section
          aria-labelledby="follow-ups-error-title"
          className="rounded-2xl border border-red-200 bg-white p-6 sm:p-8"
        >
          <h2
            id="follow-ups-error-title"
            className="text-lg font-semibold text-zinc-950"
          >
            Nie udało się pobrać follow-upów
          </h2>
          <p role="alert" className="mt-2 text-sm leading-7 text-zinc-600">
            Sprawdź połączenie i spróbuj ponownie. Dane nie zostały wyświetlone.
          </p>
          <a
            href="/follow-ups"
            className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-[#542b39] px-4 text-sm font-medium text-white hover:bg-[#43222d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900"
          >
            Spróbuj ponownie
          </a>
        </section>
      )}
    </div>
  );
}
