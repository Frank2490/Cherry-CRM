"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { saveFollowUp } from "@/app/actions/follow-ups";
import { getLeadDetails } from "@/app/actions/leads";
import { useRouter } from "next/navigation";
import { FollowUpCalendar } from "@/components/pipeline/follow-up-calendar";
import {
  type FollowUpLead,
  type FollowUpMode,
  type FollowUpResult,
} from "@/lib/leads/follow-ups";
import { formatFollowUpDate, getTodayInWarsaw } from "@/lib/leads/pipeline";
import { isClosedLeadStatus } from "@/lib/leads/statuses";
import { FOLLOW_UP_QUICK_DATES, followUpQuickDate } from "@/lib/leads/dates";

const optionClass =
  "min-h-11 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 aria-pressed:border-[#542b39] aria-pressed:bg-[#faf5f7] aria-pressed:font-semibold aria-pressed:text-[#542b39]";

export function FollowUpDialog({
  lead,
  mode,
  onClose,
  onSaved,
}: {
  lead: FollowUpLead;
  mode: FollowUpMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const saving = useRef(false);
  const [record, setRecord] = useState(lead);
  const [date, setDate] = useState(
    mode === "complete" ? "" : (lead.follow_up_date ?? ""),
  );
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [pending, startTransition] = useTransition();
  const complete = mode === "complete";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previous;
    };
  }, []);

  function close() {
    if (!saving.current) onClose();
  }
  function selectDate(value: string) {
    setDate(value);
    setCalendarOpen(false);
    calendarRef.current?.focus();
  }
  function refreshLead() {
    if (saving.current) return;
    if (
      !window.confirm(
        "Odświeżenie danych usunie Twój wybór terminu. Wczytać aktualne dane klienta?",
      )
    )
      return;
    saving.current = true;
    setReloading(true);
    startTransition(async () => {
      try {
        const result = await getLeadDetails(lead.id);
        if (result.ok) {
          setRecord(result.lead);
          setDate(complete ? "" : (result.lead.follow_up_date ?? ""));
          setCalendarOpen(false);
          setConflict(false);
          setMessage(
            isClosedLeadStatus(result.lead.status)
              ? "Ten klient jest już zamknięty i nie ma aktywnego follow-upu."
              : "",
          );
          router.refresh();
          requestAnimationFrame(() => closeRef.current?.focus());
        } else {
          setMessage(result.message);
          requestAnimationFrame(() => errorRef.current?.focus());
        }
      } catch {
        setMessage("Nie udało się odświeżyć danych. Wybrany termin został zachowany.");
        requestAnimationFrame(() => errorRef.current?.focus());
      } finally {
        saving.current = false;
        setReloading(false);
      }
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || conflict || isClosedLeadStatus(record.status)) return;
    saving.current = true;
    setMessage("");
    const data = new FormData();
    data.set("mode", mode);
    data.set("follow_up_date", date);
    data.set("expected_updated_at", record.updated_at);
    startTransition(async () => {
      let result: FollowUpResult;
      try {
        result = await saveFollowUp(lead.id, data);
      } catch {
        result = {
          ok: false,
          message:
            "Nie udało się zapisać zmian. Wybrany termin został zachowany — spróbuj ponownie.",
        };
      }
      saving.current = false;
      if (result.ok) onSaved();
      else {
        setConflict(result.conflict === true);
        setMessage(result.message);
        requestAnimationFrame(() => errorRef.current?.focus());
      }
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="follow-up-dialog-title"
      aria-describedby="follow-up-dialog-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && calendarOpen) {
          event.preventDefault();
          event.stopPropagation();
          setCalendarOpen(false);
          calendarRef.current?.focus();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-950 shadow-xl backdrop:bg-zinc-950/35"
    >
      <div className="flex items-start justify-between gap-3 border-b border-zinc-100 p-5">
        <div className="min-w-0">
          <h2 id="follow-up-dialog-title" className="text-lg font-semibold">
            {complete ? "Wykonano kontakt" : "Przełóż follow-up"}
          </h2>
          <p className="mt-1 break-words text-sm text-zinc-600">
            {record.company_name}
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          aria-label="Zamknij wybór terminu"
          onClick={close}
          disabled={pending}
          className="size-10 shrink-0 rounded-lg text-xl text-zinc-600 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-rose-900 disabled:opacity-50"
        >
          ×
        </button>
      </div>
      <form onSubmit={submit} aria-busy={pending} className="p-5">
        <p
          id="follow-up-dialog-description"
          className="mb-4 text-sm leading-6 text-zinc-600"
        >
          {complete
            ? "Potwierdź kontakt i wybierz kolejny termin. Możesz też zostawić klienta bez terminu."
            : "Wybierz nowy termin. Data ostatniego kontaktu pozostanie bez zmian."}
        </p>
        <fieldset disabled={pending || isClosedLeadStatus(record.status)}>
          <legend className="mb-3 text-sm font-medium">
            {complete ? "Następny follow-up" : "Nowy termin"}
          </legend>
          <div className="flex flex-wrap gap-2">
            {FOLLOW_UP_QUICK_DATES.map((option) => (
              <button
                key={option.days}
                type="button"
                aria-pressed={date === followUpQuickDate(option.days)}
                className={optionClass}
                onClick={() => {
                  setDate(followUpQuickDate(option.days));
                  setCalendarOpen(false);
                }}
              >
                {option.label}
              </button>
            ))}
            <button
              ref={calendarRef}
              type="button"
              aria-expanded={calendarOpen}
              aria-controls="follow-up-date-calendar"
              className={optionClass}
              onClick={() => setCalendarOpen(!calendarOpen)}
            >
              Wybierz datę
            </button>
            <button
              type="button"
              aria-pressed={!date}
              className={optionClass}
              onClick={() => {
                setDate("");
                setCalendarOpen(false);
              }}
            >
              Bez terminu
            </button>
          </div>
          <p
            aria-live="polite"
            className="mt-4 text-sm font-medium text-zinc-800"
          >
            {date
              ? `Wybrany termin: ${formatFollowUpDate(date)}`
              : "Nie ustalono terminu"}
          </p>
          {calendarOpen && (
            <div id="follow-up-date-calendar">
              <FollowUpCalendar
                value={date}
                today={getTodayInWarsaw()}
                onSelect={selectDate}
              />
            </div>
          )}
        </fieldset>
        {message && (
          <p
            ref={errorRef}
            role="alert"
            tabIndex={-1}
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-800"
          >
            {message}
          </p>
        )}
        {conflict && (
          <button
            type="button"
            onClick={refreshLead}
            disabled={pending}
            className={`mt-3 ${optionClass}`}
          >
            {reloading ? "Wczytywanie…" : "Odśwież dane"}
          </button>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className={optionClass}
          >
            Anuluj
          </button>
          <button
            type="submit"
            disabled={pending || conflict || isClosedLeadStatus(record.status)}
            className="min-h-11 rounded-lg bg-[#542b39] px-4 text-sm font-medium text-white hover:bg-[#43222d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 disabled:cursor-wait disabled:opacity-60"
          >
            {reloading
              ? "Wczytywanie…"
              : pending
              ? "Zapisywanie…"
              : complete
                ? "Potwierdź wykonanie"
                : "Zapisz termin"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
