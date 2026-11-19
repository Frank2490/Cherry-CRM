"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FollowUpDialog } from "@/components/follow-ups/follow-up-dialog";
import { LeadPanel } from "@/components/pipeline/lead-panel";
import {
  groupFollowUps,
  type FollowUpLead,
  type FollowUpMode,
} from "@/lib/leads/follow-ups";
import { formatFollowUpDate } from "@/lib/leads/pipeline";
import { useTodayInWarsaw } from "@/lib/leads/use-today-in-warsaw";
import { LEAD_STATUSES } from "@/lib/leads/statuses";

type OpenPanel = {
  lead: FollowUpLead;
  mode: FollowUpMode | "details";
  trigger: string;
};
const buttonClass =
  "min-h-11 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900";

export function FollowUpsList({
  leads,
  initialToday,
}: {
  leads: FollowUpLead[];
  initialToday: string;
}) {
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  const today = useTodayInWarsaw(initialToday);
  const [opened, setOpened] = useState<OpenPanel | null>(null);
  const [success, setSuccess] = useState("");
  const groups = groupFollowUps(leads, today);

  function open(lead: FollowUpLead, mode: OpenPanel["mode"], trigger: string) {
    setSuccess("");
    setOpened({ lead, mode, trigger });
  }

  function close(restoreTrigger = true) {
    const trigger = restoreTrigger ? opened?.trigger : undefined;
    setOpened(null);
    requestAnimationFrame(() => {
      (trigger
        ? (document.getElementById(trigger) ?? listRef.current)
        : listRef.current
      )?.focus();
    });
  }

  return (
    <div ref={listRef} tabIndex={-1} className="min-w-0 space-y-8 outline-none">
      {success && (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          {success}
        </p>
      )}
      <p className="text-xs text-zinc-500">
        Terminy według kalendarza Europe/Warsaw. Widoczni są tylko aktywni
        klienci.
      </p>
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`follow-ups-${group.key}`}>
          <header className="mb-3 flex items-center gap-3">
            <h2
              id={`follow-ups-${group.key}`}
              className={`text-lg font-semibold ${group.key === "overdue" ? "text-red-800" : "text-zinc-950"}`}
            >
              {group.label}
            </h2>
            <span
              aria-label={`Liczba leadów: ${group.leads.length}`}
              className={`rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${group.key === "overdue" ? "bg-red-100 text-red-800" : "bg-zinc-100 text-zinc-600"}`}
            >
              {group.leads.length}
            </span>
          </header>
          {group.leads.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-200 bg-white px-5 py-5 text-sm text-zinc-500">
              {group.empty}
            </p>
          ) : (
            <div className="grid min-w-0 gap-3 xl:grid-cols-2">
              {group.leads.map((lead) => {
                const status = LEAD_STATUSES.find(
                  (entry) => entry.value === lead.status,
                )!;
                const detailsId = `follow-up-details-${lead.id}`;
                return (
                  <article
                    key={lead.id}
                    className="relative isolate min-w-0 cursor-pointer rounded-xl border border-l-4 border-zinc-200 bg-white p-4 sm:p-5"
                    style={{ borderLeftColor: status.color }}
                  >
                    <button
                      id={detailsId}
                      type="button"
                      aria-haspopup="dialog"
                      aria-label={`${lead.company_name} — otwórz szczegóły leada, ${status.label}`}
                      onClick={() => open(lead, "details", detailsId)}
                      className="absolute inset-0 z-10 cursor-pointer touch-manipulation rounded-xl hover:bg-zinc-950/2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900"
                    />
                    <h3 className="text-base font-semibold text-zinc-950 [overflow-wrap:anywhere]">
                      {lead.company_name}
                    </h3>
                    <p
                      className={`mt-3 text-sm ${group.key === "overdue" ? "font-medium text-red-800" : "text-zinc-600"}`}
                    >
                      {lead.follow_up_date ? (
                        <>
                          <span className="sr-only">Termin follow-upu: </span>
                          <time dateTime={lead.follow_up_date}>
                            {formatFollowUpDate(lead.follow_up_date)}
                          </time>
                          {group.key === "overdue" && " · Zaległy"}
                        </>
                      ) : (
                        "Nie zaplanowano follow-upu"
                      )}
                    </p>
                    {lead.next_step?.trim() && (
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-600 [overflow-wrap:anywhere]">
                        <span className="font-medium text-zinc-800">
                          Następny krok:{" "}
                        </span>
                        {lead.next_step}
                      </p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(
                        [
                          { mode: "complete", label: "Wykonano" },
                          { mode: "reschedule", label: "Przełóż" },
                        ] as const
                      ).map((action) => {
                        const id = `follow-up-${action.mode}-${lead.id}`;
                        return (
                          <button
                            key={action.mode}
                            id={id}
                            type="button"
                            aria-haspopup="dialog"
                            aria-label={`${action.label}: ${lead.company_name}`}
                            onClick={() => open(lead, action.mode, id)}
                            className={`relative z-20 ${
                              action.mode === "complete"
                                ? "min-h-11 rounded-lg bg-[#542b39] px-3 py-2 text-sm font-medium text-white hover:bg-[#43222d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900"
                                : buttonClass
                            }`}
                          >
                            {action.label}
                          </button>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ))}
      {opened &&
        (opened.mode === "details" ? (
          <LeadPanel
            key={opened.lead.id}
            leadId={opened.lead.id}
            companyName={opened.lead.company_name}
            onClose={close}
          />
        ) : (
          <FollowUpDialog
            key={`${opened.lead.id}-${opened.mode}`}
            lead={opened.lead}
            mode={opened.mode}
            onClose={close}
            onSaved={() => {
              setSuccess(
                opened.mode === "complete"
                  ? "Kontakt oznaczono jako wykonany. Kolejny termin został zapisany."
                  : "Termin follow-upu został zapisany.",
              );
              close(false);
              router.refresh();
            }}
          />
        ))}
    </div>
  );
}
