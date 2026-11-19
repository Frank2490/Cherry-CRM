"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { PipelineColumn } from "@/components/pipeline/pipeline-column";
import { LeadPanel } from "@/components/pipeline/lead-panel";
import { LeadCard } from "@/components/pipeline/lead-card";
import {
  pipelineCollision,
  pipelineKeyboardCoordinates,
} from "@/components/pipeline/pipeline-drag";
import { moveLeadStatus } from "@/app/actions/leads";
import { useTodayInWarsaw } from "@/lib/leads/use-today-in-warsaw";
import type { LeadStatusSnapshot, MoveLeadResult } from "@/lib/leads/move";
import {
  isClosedLeadStatus,
  isLeadStatus,
  LEAD_STATUSES,
} from "@/lib/leads/statuses";
import {
  getTodayInWarsaw,
  groupPipelineLeads,
  formatFollowUpDate,
  type PipelineLead,
} from "@/lib/leads/pipeline";

export function PipelineBoard({ leads, initialToday }: { leads: PipelineLead[]; initialToday?: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<PipelineLead | null>(null);
  const [active, setActive] = useState<PipelineLead | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<LeadStatusSnapshot | null>(null);
  const [previousLeads, setPreviousLeads] = useState(leads);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const saving = useRef(false);
  const dragging = useRef(false);
  const suppressClickUntil = useRef(0);
  const boardRef = useRef<HTMLDivElement>(null);
  // Nowy odczyt SSR staje się źródłem danych po zakończeniu zapisu. W trakcie
  // żądania zachowujemy optymistyczną pozycję karty.
  if (previousLeads !== leads) {
    setPreviousLeads(leads);
    if (!pendingId) setOptimistic(null);
  }
  const displayed = optimistic
    ? leads.map((lead) =>
        lead.id === optimistic.id ? { ...lead, ...optimistic } : lead,
      )
    : leads;
  const groups = groupPipelineLeads(displayed);
  const today = useTodayInWarsaw(initialToday ?? getTodayInWarsaw());
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter", "Tab"],
      },
      coordinateGetter: pipelineKeyboardCoordinates,
      scrollBehavior: "auto",
    }),
  );

  function openLead(lead: PipelineLead) {
    if (
      saving.current ||
      dragging.current ||
      Date.now() < suppressClickUntil.current
    )
      return;
    setSelected(lead);
  }
  function finishDrag() {
    dragging.current = false;
    suppressClickUntil.current = Date.now() + 500;
    setActive(null);
  }
  function focusCard(id: string) {
    requestAnimationFrame(() => {
      const trigger = document.getElementById(`lead-card-${id}`);
      trigger?.scrollIntoView?.({
        block: "nearest",
        inline: "nearest",
        behavior: "auto",
      });
      (trigger ?? boardRef.current)?.focus({ preventScroll: true });
    });
  }
  async function dropLead({ active: dragged, over }: DragEndEvent) {
    finishDrag();
    if (saving.current) return;
    const lead =
      active?.id === dragged.id
        ? active
        : displayed.find((entry) => entry.id === dragged.id);
    const status = over?.id;
    if (!lead || !isLeadStatus(status) || status === lead.status) {
      if (lead) focusCard(lead.id);
      return;
    }
    saving.current = true;
    const clearDate =
      isClosedLeadStatus(status) && lead.follow_up_date !== null;
    if (
      clearDate &&
      !window.confirm(
        `Przeniesienie „${lead.company_name}” do „${LEAD_STATUSES.find((entry) => entry.value === status)!.label}” usunie follow-up zaplanowany na ${formatFollowUpDate(lead.follow_up_date!)}. Kontynuować?`,
      )
    ) {
      saving.current = false;
      suppressClickUntil.current = Date.now() + 500;
      focusCard(lead.id);
      return;
    }
    setPendingId(lead.id);
    setError("");
    setConflict(false);
    setMessage("Zapisywanie statusu…");
    setOptimistic({
      id: lead.id,
      updated_at: lead.updated_at,
      status,
      follow_up_date: isClosedLeadStatus(status) ? null : lead.follow_up_date,
    });
    let result: MoveLeadResult;
    try {
      result = await moveLeadStatus(lead.id, {
        status,
        expectedUpdatedAt: lead.updated_at,
        expectedStatus: lead.status,
        expectedFollowUpDate: lead.follow_up_date,
        clearFollowUpConfirmed: clearDate,
      });
    } catch {
      result = {
        ok: false,
        message:
          "Nie udało się zapisać statusu. Karta wróciła do poprzedniej kolumny — spróbuj ponownie.",
      };
    }
    saving.current = false;
    setPendingId(null);
    if (result.ok) {
      setOptimistic(result.lead);
      setMessage(`Status leada „${lead.company_name}” został zapisany.`);
      router.refresh();
    } else {
      setOptimistic(null);
      setMessage("");
      setError(result.message);
      setConflict(result.conflict === true);
    }
    focusCard(lead.id);
  }

  return (
    <div className="min-w-0">
      <p
        id="pipeline-scroll-hint"
        className="mb-4 text-xs leading-6 text-zinc-500"
      >
        Przewiń w poziomie, aby zobaczyć wszystkie etapy. Kliknij kartę, aby ją
        otworzyć, lub przeciągnij do innej kolumny. Na telefonie przytrzymaj
        kartę.
        <span className="hidden sm:inline">
          {" "}
          Klawiatura: Enter otwiera, Spacja chwyta, ←/→ zmieniają kolumnę,
          Spacja zatwierdza, Escape anuluje.
        </span>
      </p>
      {message && (
        <p
          role="status"
          className="mb-4 rounded-lg bg-[#faf5f7] px-4 py-3 text-sm text-[#542b39]"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
        >
          {error}
        </p>
      )}
      {conflict && (
        <button
          type="button"
          onClick={() => {
            router.refresh();
            setConflict(false);
            setError("");
          }}
          className="mb-4 min-h-11 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-700 focus-visible:outline-2 focus-visible:outline-rose-900"
        >
          Odśwież dane
        </button>
      )}
      <DndContext
        id="pipeline-dnd"
        sensors={sensors}
        collisionDetection={pipelineCollision}
        autoScroll={{ canScroll: (element) => element === boardRef.current }}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "Enter otwiera panel leada. Spacja rozpoczyna przeciąganie. Strzałki w lewo i prawo wybierają kolumnę. Spacja lub Enter upuszcza kartę. Escape anuluje.",
          },
          announcements: {
            onDragStart: ({ active }) =>
              `Chwycono kartę ${active.data.current?.companyName ?? "leada"}. Wybierz kolumnę strzałkami w lewo lub prawo.`,
            onDragOver: ({ over }) =>
              over
                ? `Kolumna: ${LEAD_STATUSES.find((entry) => entry.value === over.id)?.label ?? ""}.`
                : "Karta jest poza kolumnami.",
            onDragEnd: ({ over }) =>
              over
                ? "Zakończono przeciąganie. Sprawdź komunikat zapisu statusu."
                : "Anulowano przeniesienie poza kolumnami.",
            onDragCancel: () =>
              "Anulowano przeciąganie. Status pozostaje bez zmian.",
          },
        }}
        onDragStart={({ active }) => {
          if (saving.current) return;
          dragging.current = true;
          setError("");
          setMessage("");
          setActive(displayed.find((lead) => lead.id === active.id) ?? null);
        }}
        onDragCancel={({ active }) => {
          finishDrag();
          focusCard(String(active.id));
        }}
        onDragEnd={dropLead}
      >
        <div
          ref={boardRef}
          role="region"
          aria-label="Pipeline według statusu"
          aria-describedby="pipeline-scroll-hint"
          aria-busy={pendingId !== null}
          tabIndex={0}
          className={`flex w-full max-w-full gap-4 overflow-x-auto overscroll-x-contain rounded-xl pb-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-rose-900 ${active ? "snap-none" : "snap-x snap-proximity"}`}
        >
          {groups.map(({ status, leads: columnLeads }) => (
            <PipelineColumn
              key={status.value}
              status={status}
              leads={columnLeads}
              today={today}
              onOpenLead={openLead}
              disabled={pendingId !== null}
            />
          ))}
        </div>
        <DragOverlay
          dropAnimation={{ duration: 140, easing: "ease-out" }}
          className="cursor-grabbing motion-reduce:transition-none"
        >
          {active && (
            <div
              aria-hidden="true"
              className="rotate-1 rounded-lg shadow-xl ring-2 ring-[#734353]"
            >
              <LeadCard
                lead={active}
                status={
                  LEAD_STATUSES.find((entry) => entry.value === active.status)!
                }
                today={today}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {selected && (
        <LeadPanel
          key={selected.id}
          leadId={selected.id}
          companyName={selected.company_name}
          onClose={() => {
            const id = selected.id;
            setSelected(null);
            requestAnimationFrame(() => {
              const trigger = document.getElementById(`lead-card-${id}`);
              (trigger ?? boardRef.current)?.focus();
            });
          }}
        />
      )}
    </div>
  );
}
