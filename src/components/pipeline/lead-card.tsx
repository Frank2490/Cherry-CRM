import { SectionIcon } from "@/components/section-icon";
import {
  formatEstimatedValue,
  formatFollowUpDate,
  getPrimaryContact,
  isFollowUpOverdue,
  type PipelineLead,
} from "@/lib/leads/pipeline";
import type { LeadStatusConfig } from "@/lib/leads/statuses";
import type { useDraggable } from "@dnd-kit/core";

type LeadCardProps = {
  lead: PipelineLead;
  status: LeadStatusConfig;
  today: string;
  onOpen?: (lead: PipelineLead) => void;
  drag?: Pick<
    ReturnType<typeof useDraggable>,
    "attributes" | "listeners" | "setActivatorNodeRef"
  > & { disabled: boolean };
};

export function LeadCard({ lead, status, today, onOpen, drag }: LeadCardProps) {
  const contact = getPrimaryContact(lead);
  const service = lead.service_type?.trim();
  const overdue = isFollowUpOverdue(lead, today);

  return (
    <article
      className="relative min-w-0 rounded-lg border border-l-8 border-zinc-200 bg-white p-4 shadow-xs"
      style={{ borderLeftColor: status.color }}
    >
      {onOpen && (
        <button
          ref={drag?.setActivatorNodeRef}
          {...drag?.attributes}
          {...drag?.listeners}
          id={`lead-card-${lead.id}`}
          type="button"
          disabled={drag?.disabled}
          aria-label={`Otwórz leada: ${lead.company_name}`}
          aria-haspopup="dialog"
          onClick={() => onOpen(lead)}
          className={`absolute inset-0 select-none touch-manipulation rounded-lg hover:bg-zinc-950/2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 [-webkit-touch-callout:none] disabled:cursor-wait ${drag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
        />
      )}
      <h3 className="text-sm font-semibold leading-6 text-zinc-950 [overflow-wrap:anywhere]">
        {lead.company_name}
      </h3>
      {contact && (
        <p className="mt-2 text-xs leading-5 text-zinc-600 [overflow-wrap:anywhere]">
          <span className="text-zinc-500">{contact.label}: </span>
          {contact.value}
        </p>
      )}

      {(service || lead.estimated_value !== null) && (
        <dl className="mt-3 space-y-2">
          {service && (
            <div>
              <dt className="sr-only">Rodzaj usługi</dt>
              <dd className="inline-block max-w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs leading-5 text-zinc-600 [overflow-wrap:anywhere]">
                {service}
              </dd>
            </div>
          )}
          {lead.estimated_value !== null && (
            <div>
              <dt className="sr-only">Orientacyjna wartość zlecenia</dt>
              <dd className="text-sm font-medium tabular-nums text-zinc-800">
                {formatEstimatedValue(lead.estimated_value)}
              </dd>
            </div>
          )}
        </dl>
      )}

      {lead.follow_up_date ? (
        <div className="mt-4 border-t border-zinc-100 pt-3">
          <p className="mb-1 text-xs text-zinc-500">Następny follow-up</p>
          <div
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 ${
              overdue ? "font-medium text-red-800" : "text-zinc-600"
            }`}
          >
            <SectionIcon name="calendar" className="size-3.5 shrink-0" />
            <time dateTime={lead.follow_up_date}>
              {formatFollowUpDate(lead.follow_up_date)}
            </time>
            {overdue && (
              <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
                Zaległy
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-4 border-t border-zinc-100 pt-3 text-xs leading-5 text-zinc-500">
          Nie zaplanowano follow-upu
        </p>
      )}
    </article>
  );
}
