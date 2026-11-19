"use client";

import { useDraggable } from "@dnd-kit/core";
import { LeadCard } from "@/components/pipeline/lead-card";
import type { PipelineLead } from "@/lib/leads/pipeline";
import type { LeadStatusConfig } from "@/lib/leads/statuses";

export function DraggableLeadCard({
  lead,
  status,
  today,
  disabled,
  onOpen,
}: {
  lead: PipelineLead;
  status: LeadStatusConfig;
  today: string;
  disabled: boolean;
  onOpen?: (lead: PipelineLead) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({
      id: lead.id,
      data: { status: lead.status, companyName: lead.company_name },
      disabled,
      attributes: { roleDescription: "karta leada do przeciągania" },
    });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg transition-[opacity,box-shadow] duration-150 motion-reduce:transition-none ${isDragging ? "opacity-35 ring-2 ring-[#734353]" : ""}`}
    >
      <LeadCard
        lead={lead}
        status={status}
        today={today}
        onOpen={onOpen}
        drag={{ attributes, listeners, setActivatorNodeRef, disabled }}
      />
    </div>
  );
}
