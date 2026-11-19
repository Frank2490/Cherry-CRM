import type { Metadata } from "next";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";
import { AddLeadDialog } from "@/components/pipeline/add-lead-dialog";
import { getPipelineLeads } from "@/lib/leads/queries";
import { getTodayInWarsaw } from "@/lib/leads/dates";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const result = await getPipelineLeads();

  return (
    <div className="min-w-0">
      <header className="mb-8 flex flex-col gap-5 sm:mb-10 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-[34px]">
            Pipeline
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-600 sm:text-base">
            Prowadź klientów od pierwszego kontaktu do rozpoczęcia współpracy.
          </p>
        </div>
        <AddLeadDialog />
      </header>

      {result.ok ? (
        <PipelineBoard leads={result.leads} initialToday={getTodayInWarsaw()} />
      ) : (
        <section
          aria-labelledby="pipeline-error-title"
          className="rounded-2xl border border-red-200 bg-white p-6 sm:p-8"
        >
          <h2
            id="pipeline-error-title"
            className="text-lg font-semibold text-zinc-950"
          >
            Nie udało się pobrać leadów
          </h2>
          <p role="alert" className="mt-2 text-sm leading-7 text-zinc-600">
            Dane nie zostały wyświetlone. Sprawdź połączenie i spróbuj ponownie.
          </p>
          {/* Zwykły link wymusza nowy odczyt serwerowy także na bieżącej trasie. */}
          <a
            href="/pipeline"
            className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-[#542b39] px-4 text-sm font-medium text-white hover:bg-[#43222d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900"
          >
            Spróbuj ponownie
          </a>
        </section>
      )}
    </div>
  );
}
