"use client";

import { useDroppable } from "@dnd-kit/core";
import { DraggableLeadCard } from "@/components/pipeline/draggable-lead-card";
import type { PipelineLead } from "@/lib/leads/pipeline";
import type { LeadStatusConfig } from "@/lib/leads/statuses";

type PipelineColumnProps = {
  status: LeadStatusConfig;
  leads: PipelineLead[];
  today: string;
  onOpenLead?: (lead: PipelineLead) => void;
  disabled?: boolean;
};

export function PipelineColumn({
  status,
  leads,
  today,
  onOpenLead,
  disabled = false,
}: PipelineColumnProps) {
  const headingId = `pipeline-status-${status.value}`;
  const { setNodeRef, isOver } = useDroppable({ id: status.value, disabled });

  return (
    <section
      ref={setNodeRef}
      id={`pipeline-column-${status.value}`}
      aria-labelledby={headingId}
      className={`flex w-[min(18rem,calc(100vw-2.5rem))] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-t-4 border-zinc-200 transition-[background-color,box-shadow] duration-150 motion-reduce:transition-none sm:w-72 ${isOver ? "ring-2 ring-inset" : ""}`}
      style={{
        borderTopColor: status.color,
        backgroundColor: `${status.color}${isOver ? "24" : "0d"}`,
        ...(isOver ? { boxShadow: `inset 0 0 0 2px ${status.color}` } : {}),
      }}
    >
      <header className="flex min-h-17 items-center gap-2.5 border-b border-zinc-200 bg-white px-4 py-3">
        <span
          aria-hidden="true"
          className="size-3 shrink-0 rounded-sm"
          style={{ backgroundColor: status.color }}
        />
        <h2
          id={headingId}
          className="min-w-0 flex-1 text-sm font-semibold leading-5 text-zinc-900"
        >
          {status.label}
        </h2>
        <span
          aria-label={`Liczba leadów: ${leads.length}`}
          className="flex min-w-7 items-center justify-center rounded-md bg-zinc-100 px-1.5 py-1 text-xs font-semibold tabular-nums text-zinc-600"
        >
          {leads.length}
        </span>
      </header>

      <div className="min-h-96 flex-1 p-3">
        {leads.length ? (
          <ul className="space-y-3">
            {leads.map((lead) => (
              <li key={lead.id}>
                <DraggableLeadCard
                  lead={lead}
                  status={status}
                  today={today}
                  onOpen={onOpenLead}
                  disabled={disabled}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-zinc-300/80 px-3 py-6 text-center text-xs leading-6 text-zinc-500">
            Nie ma jeszcze klientów na tym etapie.
          </p>
        )}
      </div>
    </section>
  );
}
