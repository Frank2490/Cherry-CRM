"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { LeadPanel } from "@/components/pipeline/lead-panel";
import {
  calendarDayLabel,
  calendarMonthLabel,
  getCalendarDays,
  groupCalendarLeads,
  moveCalendarAnchor,
  type CalendarView,
} from "@/lib/leads/calendar";
import { calendarNavigation, isValidDateOnly } from "@/lib/leads/dates";
import type { FollowUpLead } from "@/lib/leads/follow-ups";
import { formatFollowUpDate, getTodayInWarsaw } from "@/lib/leads/pipeline";
import { LEAD_STATUSES } from "@/lib/leads/statuses";

const weekdays = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Niedz"];
const optionClass =
  "min-h-11 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 disabled:opacity-40 aria-pressed:border-[#542b39] aria-pressed:bg-[#faf5f7] aria-pressed:text-[#542b39]";
const previewCount = 2;

function CalendarLead({
  lead,
  id,
  onOpen,
}: {
  lead: FollowUpLead;
  id: string;
  onOpen: (lead: FollowUpLead, id: string) => void;
}) {
  const status = LEAD_STATUSES.find((entry) => entry.value === lead.status)!;
  return (
    <button
      id={id}
      type="button"
      aria-haspopup="dialog"
      aria-label={`Otwórz klienta: ${lead.company_name}, ${status.label}`}
      title={`${lead.company_name} · ${status.label}`}
      onClick={() => onOpen(lead, id)}
      className="min-h-10 w-full min-w-0 rounded-md border border-l-4 border-zinc-200 bg-white px-2 py-2 text-left text-xs font-medium leading-5 text-zinc-800 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose-900 [overflow-wrap:anywhere]"
      style={{ borderLeftColor: status.color }}
    >
      <span className="line-clamp-2">{lead.company_name}</span>
      <span
        className="mt-0.5 block text-[11px] font-normal"
        style={{ color: status.textColor }}
      >
        {status.label}
      </span>
    </button>
  );
}

export function FollowUpCalendarView({
  result,
  initialToday,
  anchor,
  view,
  days,
}: {
  result: { ok: true; leads: FollowUpLead[] } | { ok: false };
  initialToday: string;
  anchor: string;
  view: CalendarView;
  days: ReturnType<typeof getCalendarDays>;
}) {
  const router = useRouter();
  const calendarRef = useRef<HTMLDivElement>(null);
  const focusDay = useRef<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [today, setToday] = useState(initialToday);
  const rangeKey = `${view}:${days[0].value}`;
  const [selection, setSelection] = useState({ rangeKey, day: anchor });
  const selectedDay = selection.rangeKey === rangeKey ? selection.day : anchor;
  if (selection.rangeKey !== rangeKey) setSelection({ rangeKey, day: anchor });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [opened, setOpened] = useState<{
    lead: FollowUpLead;
    trigger: string;
  } | null>(null);
  const byDate = groupCalendarLeads(result.ok ? result.leads : []);
  const selectedLeads = byDate.get(selectedDay) ?? [];
  const count = days
    .filter((day) => day.inMonth)
    .reduce((sum, day) => sum + (byDate.get(day.value)?.length ?? 0), 0);
  const label =
    view === "month"
      ? calendarMonthLabel(anchor)
      : `${formatFollowUpDate(days[0].value)} – ${formatFollowUpDate(days[6].value)}`;

  useEffect(() => {
    const updateToday = () => setToday(getTodayInWarsaw());
    updateToday();
    const timer = window.setInterval(updateToday, 30_000);
    window.addEventListener("focus", updateToday);
    document.addEventListener("visibilitychange", updateToday);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateToday);
      document.removeEventListener("visibilitychange", updateToday);
    };
  }, []);

  useEffect(() => {
    if (focusDay.current !== anchor) return;
    focusDay.current = null;
    document.getElementById(`calendar-day-${anchor}`)?.focus();
  }, [anchor, view]);

  function showRange(next: string, nextView = view, focus = false) {
    if (isPending) return;
    const sameRange = nextView === view &&
      getCalendarDays(next, nextView)[0].value === days[0].value;
    if (sameRange) {
      chooseDay(next);
      return;
    }
    focusDay.current = focus ? next : null;
    startTransition(() => {
      router.replace(`/calendar?view=${nextView}&date=${next}`, { scroll: false });
    });
  }

  function navigate(direction: number) {
    const next = moveCalendarAnchor(anchor, view, direction);
    if (next) showRange(next);
  }
  function chooseDay(value: string) {
    setSelection({ rangeKey, day: value });
  }
  function navigateDay(event: KeyboardEvent<HTMLButtonElement>, value: string) {
    let next: string | null;
    if (event.key === "PageUp" || event.key === "PageDown")
      next = moveCalendarAnchor(value, view, event.key === "PageUp" ? -1 : 1);
    else next = calendarNavigation(value, event.key);
    if (!next || isPending) return;
    event.preventDefault();
    // Zmieniamy zakres tylko wtedy, gdy cel wyszedł poza widoczną siatkę.
    if (!days.some((day) => day.value === next)) {
      showRange(next, view, true);
      return;
    }
    chooseDay(next);
    requestAnimationFrame(() =>
      document.getElementById(`calendar-day-${next}`)?.focus(),
    );
  }
  function openLead(lead: FollowUpLead, trigger: string) {
    if (!isPending) setOpened({ lead, trigger });
  }
  function closeLead() {
    const trigger = opened?.trigger;
    setOpened(null);
    requestAnimationFrame(() => {
      (
        (trigger && document.getElementById(trigger)) ||
        document.getElementById(`calendar-day-${selectedDay}`) ||
        calendarRef.current
      )?.focus();
    });
  }
  function showMore(date: string) {
    setExpanded((previous) => ({ ...previous, [date]: !previous[date] }));
  }

  return (
    <div ref={calendarRef} tabIndex={-1} className="min-w-0 outline-none">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label={
              view === "month" ? "Poprzedni miesiąc" : "Poprzedni tydzień"
            }
            disabled={isPending || !moveCalendarAnchor(anchor, view, -1)}
            onClick={() => navigate(-1)}
            className={optionClass}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={
              view === "month" ? "Następny miesiąc" : "Następny tydzień"
            }
            disabled={isPending || !moveCalendarAnchor(anchor, view, 1)}
            onClick={() => navigate(1)}
            className={optionClass}
          >
            ›
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              const date = getTodayInWarsaw();
              setToday(date);
              showRange(date);
            }}
            className={optionClass}
          >
            Dziś
          </button>
          <h2
            id="calendar-range-title"
            aria-live="polite"
            className="w-full text-lg font-semibold first-letter:uppercase text-zinc-950 sm:ml-2 sm:w-auto"
          >
            {label}
          </h2>
        </div>
        <div role="group" aria-label="Widok kalendarza" className="flex gap-2">
          {(
            [
              { value: "month", label: "Miesiąc" },
              { value: "week", label: "Tydzień" },
            ] as const
          ).map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-pressed={view === entry.value}
              disabled={isPending}
              className={optionClass}
              onClick={() => showRange(selectedDay, entry.value)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-4 text-xs leading-6 text-zinc-500">
        Terminy według kalendarza Europe/Warsaw. Kolory oznaczają status
        klienta.
      </p>
      {isPending ? (
        <p role="status" className="mb-4 text-sm text-zinc-600">Ładowanie kalendarza…</p>
      ) : !result.ok ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-white p-4">
          <p role="alert" className="text-sm text-red-800">Nie udało się pobrać kalendarza.</p>
          <button type="button" className={`mt-3 ${optionClass}`} onClick={() => startTransition(() => router.refresh())}>
            Spróbuj ponownie
          </button>
        </div>
      ) : (
        <p
          role="status"
          className={`mb-4 text-sm ${count === 0 ? "rounded-lg border border-dashed border-zinc-200 bg-white p-4 text-zinc-600" : "text-zinc-600"}`}
        >
          {count === 0
            ? `Brak zaplanowanych kontaktów w tym ${view === "month" ? "miesiącu" : "tygodniu"}.`
            : `Zaplanowane kontakty: ${count}`}
        </p>
      )}
      <p className="mb-3 text-xs text-zinc-500 sm:hidden">
        Wybierz dzień, aby zobaczyć klientów poniżej.
      </p>
      <div
        role="region"
        aria-labelledby="calendar-range-title"
        aria-busy={isPending}
        className="overflow-hidden rounded-xl border border-zinc-200 bg-white"
      >
        <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
          {weekdays.map((day) => (
            <span
              key={day}
              className="py-3 text-center text-[11px] font-medium text-zinc-600 sm:text-xs"
            >
              {day}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const valid = isValidDateOnly(day.value);
            const entries = byDate.get(day.value) ?? [];
            const visible = expanded[day.value]
              ? entries
              : entries.slice(0, previewCount);
            return (
              <div
                key={day.value}
                data-date={day.value}
                className={`min-w-0 border-r border-b border-zinc-100 p-0.5 sm:min-h-24 sm:p-2 ${day.inMonth ? "bg-white" : "bg-zinc-50"} ${selectedDay === day.value ? "ring-1 ring-inset ring-[#734353]" : ""}`}
              >
                <button
                  id={`calendar-day-${day.value}`}
                  type="button"
                  disabled={!valid}
                  tabIndex={selectedDay === day.value ? 0 : -1}
                  aria-pressed={selectedDay === day.value}
                  aria-current={day.value === today ? "date" : undefined}
                  aria-label={
                    valid
                      ? `${calendarDayLabel(day.value)}${result.ok ? `, kontakty: ${entries.length}` : ""}`
                      : "Dzień poza obsługiwanym zakresem"
                  }
                  onClick={() => chooseDay(day.value)}
                  onKeyDown={(event) => navigateDay(event, day.value)}
                  className={`flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-md text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose-900 sm:flex-row sm:justify-between sm:px-2 ${day.value === today ? "bg-[#542b39] font-semibold text-white" : day.inMonth ? "text-zinc-800 hover:bg-zinc-100" : "text-zinc-400 hover:bg-zinc-100"}`}
                >
                  <span>{valid ? day.day : ""}</span>
                  {entries.length > 0 && (
                    <span
                      className={`rounded px-1 text-[10px] tabular-nums ${day.value === today ? "bg-white/15 text-white" : "bg-[#f2e8ed] text-[#542b39]"}`}
                    >
                      {entries.length}
                    </span>
                  )}
                </button>
                <div className="mt-1 hidden space-y-1.5 sm:block">
                  <div
                    id={`calendar-events-${day.value}`}
                    className="space-y-1.5"
                  >
                    {visible.map((lead) => (
                      <CalendarLead
                        key={lead.id}
                        lead={lead}
                        id={`calendar-grid-${day.value}-${lead.id}`}
                        onOpen={openLead}
                      />
                    ))}
                  </div>
                  {entries.length > previewCount && (
                    <button
                      type="button"
                      aria-expanded={Boolean(expanded[day.value])}
                      aria-controls={`calendar-events-${day.value}`}
                      onClick={() => showMore(day.value)}
                      className="min-h-10 w-full rounded-md px-1 text-left text-xs font-medium text-[#542b39] hover:bg-[#faf5f7] focus-visible:outline-2 focus-visible:outline-rose-900"
                    >
                      {expanded[day.value]
                        ? "Zwiń listę"
                        : `Pokaż pozostałe (${entries.length - previewCount})`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <section
        aria-labelledby="calendar-selected-title"
        className="mt-5 rounded-xl border border-zinc-200 bg-white p-4 sm:hidden"
      >
        <h2
          id="calendar-selected-title"
          className="text-base font-semibold first-letter:uppercase text-zinc-950"
        >
          {calendarDayLabel(selectedDay)}
        </h2>
        {result.ok && <p className="mt-1 text-xs text-zinc-500">
          Kontakty: {selectedLeads.length}
        </p>}
        {result.ok && (selectedLeads.length === 0 ? (
          <p className="mt-4 text-sm leading-6 text-zinc-500">
            Brak zaplanowanych kontaktów w wybranym dniu.
          </p>
        ) : (
          <div id="calendar-selected-events" className="mt-4 space-y-2">
            {(expanded[selectedDay]
              ? selectedLeads
              : selectedLeads.slice(0, previewCount)
            ).map((lead) => (
              <CalendarLead
                key={lead.id}
                lead={lead}
                id={`calendar-agenda-${selectedDay}-${lead.id}`}
                onOpen={openLead}
              />
            ))}
            {selectedLeads.length > previewCount && (
              <button
                type="button"
                aria-expanded={Boolean(expanded[selectedDay])}
                aria-controls="calendar-selected-events"
                onClick={() => showMore(selectedDay)}
                className={optionClass}
              >
                {expanded[selectedDay]
                  ? "Zwiń listę"
                  : `Pokaż pozostałe (${selectedLeads.length - previewCount})`}
              </button>
            )}
          </div>
        ))}
      </section>
      {opened && (
        <LeadPanel
          key={opened.lead.id}
          leadId={opened.lead.id}
          companyName={opened.lead.company_name}
          onClose={closeLead}
          preferRevalidation
        />
      )}
    </div>
  );
}
