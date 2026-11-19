"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { deleteLead, getLeadDetails, updateLead } from "@/app/actions/leads";
import { FollowUpCalendar } from "@/components/pipeline/follow-up-calendar";
import { SectionIcon } from "@/components/section-icon";
import { isDialogBackdropClick, useUnsavedChanges } from "@/lib/navigation/use-unsaved-changes";
import {
  CRM_TIME_ZONE,
  FOLLOW_UP_QUICK_DATES,
  followUpQuickDate,
} from "@/lib/leads/dates";
import {
  changeEditStatus,
  hasLeadChanges,
  leadEditValues,
  type LeadDetails,
  type LeadEditErrors,
  type LeadEditValues,
  type UpdateLeadResult,
} from "@/lib/leads/details";
import { formatFollowUpDate } from "@/lib/leads/pipeline";
import {
  isClosedLeadStatus,
  isLeadStatus,
  LEAD_STATUSES,
} from "@/lib/leads/statuses";

const inputClass =
  "mt-2 min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none focus:border-[#734353] focus:ring-2 focus:ring-[#734353]/15 aria-invalid:border-red-700 disabled:bg-zinc-50";
const optionClass =
  "min-h-10 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 aria-pressed:border-[#542b39] aria-pressed:bg-[#faf5f7] aria-pressed:font-semibold aria-pressed:text-[#542b39]";

function Field({
  name,
  label,
  error,
  children,
}: {
  name: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={`lead-edit-${name}`} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p id={`lead-edit-${name}-error`} className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: CRM_TIME_ZONE,
  }).format(new Date(value));
}

type LeadPanelProps = {
  leadId: string;
  companyName: string;
  onClose: () => void;
  preferRevalidation?: boolean;
};

export function LeadPanel({ leadId, companyName, onClose, preferRevalidation = false }: LeadPanelProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const calendarTriggerRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const saving = useRef(false);
  const [lead, setLead] = useState<LeadDetails | null>(null);
  const [values, setValues] = useState<LeadEditValues | null>(null);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [errors, setErrors] = useState<LeadEditErrors>({});
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [success, setSuccess] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState("");
  const busy = pending || deleting;
  const dirty = Boolean(lead && values && hasLeadChanges(values, lead));
  const confirmDiscard = useUnsavedChanges(dirty, busy);
  const closed = values ? isClosedLeadStatus(values.status) : false;
  const canDelete = lead !== null && isClosedLeadStatus(lead.status);
  const status = LEAD_STATUSES.find((entry) => entry.value === values?.status);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getLeadDetails(leadId)
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          setLead(result.lead);
          setValues(leadEditValues(result.lead));
        } else setLoadError(result.message);
      })
      .catch(() => {
        if (active)
          setLoadError("Nie udało się pobrać danych leada. Spróbuj ponownie.");
      });
    return () => {
      active = false;
    };
  }, [leadId, retry]);

  function requestClose() {
    if (saving.current || !confirmDiscard()) return;
    onClose();
  }

  function changeField(name: keyof LeadEditValues, value: string) {
    setValues((previous) =>
      previous ? { ...previous, [name]: value } : previous,
    );
    setSuccess("");
  }

  function selectDate(value: string) {
    changeField("follow_up_date", value);
    setCalendarOpen(false);
    calendarTriggerRef.current?.focus();
  }

  function refreshLead() {
    if (saving.current) return;
    if (!confirmDiscard("Odświeżenie danych usunie Twój niezapisany szkic.")) return;
    saving.current = true;
    setReloading(true);
    startTransition(async () => {
      try {
        const result = await getLeadDetails(leadId);
        if (result.ok) {
          setLead(result.lead);
          setValues(leadEditValues(result.lead));
          setConflict(false);
          setErrors({});
          setMessage("");
          setSuccess("");
          setCalendarOpen(false);
          router.refresh();
          requestAnimationFrame(() => closeRef.current?.focus());
        } else {
          setMessage(result.message);
          requestAnimationFrame(() => errorRef.current?.focus());
        }
      } catch {
        setMessage("Nie udało się odświeżyć danych. Twój szkic został zachowany.");
        requestAnimationFrame(() => errorRef.current?.focus());
      } finally {
        saving.current = false;
        setReloading(false);
      }
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || !values || !lead || !dirty || conflict) return;
    const formData = new FormData(event.currentTarget);
    formData.set("expected_updated_at", lead.updated_at);
    saving.current = true;
    setErrors({});
    setMessage("");
    setSuccess("");
    startTransition(async () => {
      let result: UpdateLeadResult;
      try {
        result = await updateLead(leadId, formData);
      } catch {
        result = {
          ok: false,
          message:
            "Nie udało się zapisać zmian. Dane zostały zachowane — spróbuj ponownie.",
        };
      }
      saving.current = false;
      if (result.ok) {
        setLead(result.lead);
        setValues(leadEditValues(result.lead));
        setCalendarOpen(false);
        setSuccess("Zmiany zostały zapisane.");
        if (!preferRevalidation || !result.revalidated) router.refresh();
      } else {
        setConflict(result.conflict === true);
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message ?? "Sprawdź zaznaczone pola.");
        requestAnimationFrame(() => {
          const invalid = dialogRef.current?.querySelector<HTMLElement>(
            '[aria-invalid="true"], [data-invalid="true"]',
          );
          (invalid ?? errorRef.current)?.focus();
        });
      }
    });
  }

  function requestDelete() {
    if (saving.current || !canDelete) return;
    setDeleteError("");
    deleteDialogRef.current?.showModal();
  }

  function cancelDelete() {
    if (saving.current) return;
    deleteDialogRef.current?.close();
    deleteTriggerRef.current?.focus();
  }

  function confirmDelete() {
    if (saving.current || !lead || !canDelete || !deleteDialogRef.current?.open)
      return;
    saving.current = true;
    setDeleteError("");
    startDelete(async () => {
      let result: Awaited<ReturnType<typeof deleteLead>>;
      try {
        result = await deleteLead(leadId, lead.updated_at);
      } catch {
        result = {
          ok: false,
          message:
            "Nie udało się potwierdzić usunięcia leada. Sprawdź połączenie i spróbuj ponownie.",
        };
      } finally {
        saving.current = false;
      }
      if (!result.ok) {
        setDeleteError(result.message);
        return;
      }
      deleteDialogRef.current?.close();
      onClose();
      if (!result.revalidated) router.refresh();
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="lead-panel-title"
      aria-describedby="lead-panel-description"
      onClick={(event) => {
        if (isDialogBackdropClick(event)) requestClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && calendarOpen) {
          event.preventDefault();
          event.stopPropagation();
          setCalendarOpen(false);
          calendarTriggerRef.current?.focus();
        }
      }}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-xl overflow-hidden border-0 border-l border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-zinc-950/20 open:flex open:flex-col sm:rounded-l-2xl"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-[#734353]">Dane leada</p>
          <h2
            id="lead-panel-title"
            className="text-xl font-semibold tracking-tight [overflow-wrap:anywhere]"
          >
            {lead?.company_name ?? companyName}
          </h2>
          <p
            id="lead-panel-description"
            className="mt-2 text-xs leading-5 text-zinc-500"
          >
            Zaktualizuj dane i zapisz zmiany jednym kliknięciem.
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={requestClose}
          disabled={busy}
          aria-label="Zamknij panel leada"
          className="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-2xl text-zinc-500 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-rose-900 disabled:opacity-40"
        >
          ×
        </button>
      </header>

      {!values || !lead ? (
        <div className="overflow-y-auto p-5 sm:p-6">
          {loadError ? (
            <>
              <p role="alert" className="text-sm leading-6 text-red-800">
                {loadError}
              </p>
              <button
                type="button"
                onClick={() => {
                  setLoadError("");
                  setRetry((count) => count + 1);
                }}
                className="mt-4 min-h-11 rounded-lg border border-zinc-300 px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-rose-900"
              >
                Spróbuj ponownie
              </button>
            </>
          ) : (
            <p role="status" className="text-sm text-zinc-500">
              Ładowanie danych…
            </p>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <fieldset
            disabled={busy}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-5 sm:p-6">
              <form
                id="lead-edit-form"
                onSubmit={submit}
                noValidate
                aria-busy={pending}
                className="space-y-5"
              >
                <dl className="flex flex-wrap gap-x-6 gap-y-3 rounded-lg bg-zinc-50 p-3 text-xs leading-5">
                  <div>
                    <dt className="text-zinc-500">Dodano</dt>
                    <dd className="text-zinc-700">
                      <time dateTime={lead.created_at}>
                        {timestamp(lead.created_at)}
                      </time>
                    </dd>
                  </div>
                  {lead.last_contact_at && (
                    <div>
                      <dt className="text-zinc-500">Ostatni kontakt</dt>
                      <dd className="text-zinc-700">
                        <time dateTime={lead.last_contact_at}>
                          {timestamp(lead.last_contact_at)}
                        </time>
                      </dd>
                    </div>
                  )}
                </dl>

                <Field
                  name="company_name"
                  label="Nazwa firmy"
                  error={errors.company_name}
                >
                  <input
                    id="lead-edit-company_name"
                    name="company_name"
                    value={values.company_name}
                    onChange={(event) =>
                      changeField("company_name", event.target.value)
                    }
                    required
                    autoComplete="off"
                    aria-invalid={Boolean(errors.company_name)}
                    aria-describedby={
                      errors.company_name
                        ? "lead-edit-company_name-error"
                        : undefined
                    }
                    className={inputClass}
                  />
                </Field>

                <fieldset className="min-w-0 space-y-3">
                  <legend className="text-sm font-medium">
                    Dane kontaktowe
                  </legend>
                  <p className="text-xs leading-5 text-zinc-500">
                    Wystarczy jedna forma kontaktu.
                  </p>
                  {(
                    [
                      {
                        name: "instagram",
                        label: "Instagram",
                        type: "text",
                        placeholder: "@nazwafirmy",
                      },
                      {
                        name: "email",
                        label: "E-mail",
                        type: "email",
                        placeholder: "kontakt@firma.pl",
                      },
                      {
                        name: "phone",
                        label: "Telefon",
                        type: "tel",
                        placeholder: "500 600 700",
                      },
                    ] as const
                  ).map((field) => (
                    <Field
                      key={field.name}
                      name={field.name}
                      label={field.label}
                      error={errors[field.name]}
                    >
                      <input
                        id={`lead-edit-${field.name}`}
                        name={field.name}
                        type={field.type}
                        value={values[field.name]}
                        onChange={(event) =>
                          changeField(field.name, event.target.value)
                        }
                        placeholder={field.placeholder}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        aria-invalid={Boolean(
                          errors[field.name] || errors.contacts,
                        )}
                        aria-describedby={
                          errors[field.name]
                            ? `lead-edit-${field.name}-error`
                            : errors.contacts
                              ? "lead-edit-contacts-error"
                              : undefined
                        }
                        className={inputClass}
                      />
                    </Field>
                  ))}
                  {errors.contacts && (
                    <p
                      id="lead-edit-contacts-error"
                      className="text-sm text-red-800"
                    >
                      {errors.contacts}
                    </p>
                  )}
                </fieldset>

                <Field name="status" label="Status" error={errors.status}>
                  <div className="relative mt-2">
                    <select
                      id="lead-edit-status"
                      name="status"
                      value={values.status}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (!isLeadStatus(next)) return;
                        setValues((previous) =>
                          previous
                            ? changeEditStatus(previous, next)
                            : previous,
                        );
                        setSuccess("");
                        if (isClosedLeadStatus(next)) setCalendarOpen(false);
                      }}
                      aria-invalid={Boolean(errors.status)}
                      aria-describedby={
                        errors.status ? "lead-edit-status-error" : undefined
                      }
                      className={`${inputClass} mt-0 appearance-none border-l-4 pl-3 pr-10`}
                      style={{ borderLeftColor: status?.color }}
                    >
                      {LEAD_STATUSES.map((entry) => (
                        <option key={entry.value} value={entry.value}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-600"
                    >
                      <path d="m5 6 3-3 3 3M5 10l3 3 3-3" />
                    </svg>
                  </div>
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field name="service_type" label="Rodzaj usługi">
                    <input
                      id="lead-edit-service_type"
                      name="service_type"
                      value={values.service_type}
                      onChange={(event) =>
                        changeField("service_type", event.target.value)
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field
                    name="estimated_value"
                    label="Szacunkowa wartość (PLN)"
                    error={errors.estimated_value}
                  >
                    <input
                      id="lead-edit-estimated_value"
                      name="estimated_value"
                      inputMode="decimal"
                      value={values.estimated_value}
                      onChange={(event) =>
                        changeField("estimated_value", event.target.value)
                      }
                      placeholder="np. 3500,00"
                      aria-invalid={Boolean(errors.estimated_value)}
                      aria-describedby={
                        errors.estimated_value
                          ? "lead-edit-estimated_value-error"
                          : undefined
                      }
                      className={inputClass}
                    />
                  </Field>
                </div>

                <fieldset disabled={closed || pending} className="min-w-0">
                  <legend className="text-sm font-medium">
                    Następny follow-up{" "}
                    <span className="font-normal text-zinc-500">
                      (opcjonalnie)
                    </span>
                  </legend>
                  <input
                    type="hidden"
                    name="follow_up_date"
                    value={closed ? "" : values.follow_up_date}
                  />
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p
                      className={
                        values.follow_up_date
                          ? "font-medium text-zinc-800"
                          : "text-zinc-500"
                      }
                    >
                      {values.follow_up_date
                        ? formatFollowUpDate(values.follow_up_date)
                        : "Nie ustalono terminu"}
                    </p>
                    {values.follow_up_date && (
                      <button
                        type="button"
                        onClick={() => selectDate("")}
                        className="min-h-9 rounded-md px-2 text-xs font-medium text-[#734353] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-rose-900"
                      >
                        Wyczyść termin
                      </button>
                    )}
                  </div>
                  {closed ? (
                    <p className="mt-2 text-xs leading-6 text-zinc-500">
                      Dla wygranych i przegranych leadów termin pozostaje pusty.
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {FOLLOW_UP_QUICK_DATES.map((option) => (
                        <button
                          key={option.days}
                          type="button"
                          onClick={() => selectDate(followUpQuickDate(option.days))}
                          aria-pressed={
                            Boolean(values.follow_up_date) &&
                            values.follow_up_date ===
                              followUpQuickDate(option.days)
                          }
                          className={optionClass}
                        >
                          {option.label}
                        </button>
                      ))}
                      <button
                        ref={calendarTriggerRef}
                        type="button"
                        onClick={() => setCalendarOpen(!calendarOpen)}
                        aria-expanded={calendarOpen}
                        aria-controls="lead-edit-calendar"
                        data-invalid={Boolean(errors.follow_up_date)}
                        aria-describedby={
                          errors.follow_up_date
                            ? "lead-edit-follow_up_date-error"
                            : undefined
                        }
                        className={`${optionClass} flex items-center gap-2 ${calendarOpen ? "border-[#542b39] bg-[#faf5f7] text-[#542b39]" : ""}`}
                      >
                        <SectionIcon name="calendar" className="size-4" />
                        Wybierz datę
                      </button>
                    </div>
                  )}
                  {errors.follow_up_date && (
                    <p
                      id="lead-edit-follow_up_date-error"
                      className="mt-2 text-sm text-red-800"
                    >
                      {errors.follow_up_date}
                    </p>
                  )}
                  {calendarOpen && !closed && (
                    <div id="lead-edit-calendar">
                      <FollowUpCalendar
                        value={values.follow_up_date}
                        onSelect={selectDate}
                      />
                    </div>
                  )}
                </fieldset>

                {(
                  [
                    { name: "next_step", label: "Następny krok", rows: 2 },
                    { name: "notes", label: "Notatki", rows: 6 },
                  ] as const
                ).map((field) => (
                  <Field key={field.name} name={field.name} label={field.label}>
                    <textarea
                      id={`lead-edit-${field.name}`}
                      name={field.name}
                      rows={field.rows}
                      value={values[field.name]}
                      onChange={(event) =>
                        changeField(field.name, event.target.value)
                      }
                      className={`${inputClass} resize-y py-2`}
                    />
                  </Field>
                ))}

                {message && (
                  <p
                    ref={errorRef}
                    role="alert"
                    tabIndex={-1}
                    className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-900 outline-none"
                  >
                    {message}
                  </p>
                )}
                {conflict && (
                  <button
                    type="button"
                    onClick={refreshLead}
                    disabled={pending}
                    className={optionClass}
                  >
                    {reloading ? "Wczytywanie…" : "Odśwież dane"}
                  </button>
                )}
                <p
                  role="status"
                  aria-live="polite"
                  className="text-sm text-green-800"
                >
                  {success}
                </p>
              </form>
            </div>
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-white p-4 sm:px-6">
              <p className="text-xs text-zinc-500">
                {dirty ? "Niezapisane zmiany" : "Wszystkie zmiany zapisane"}
              </p>
              <button
                type="submit"
                form="lead-edit-form"
                disabled={pending || !dirty || conflict}
                className="min-h-11 rounded-lg bg-[#542b39] px-5 text-sm font-semibold text-white hover:bg-[#43222d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 disabled:cursor-default disabled:opacity-50"
              >
                {reloading
                  ? "Wczytywanie…"
                  : pending
                    ? "Zapisywanie…"
                    : "Zapisz zmiany"}
              </button>
            </footer>
            {canDelete && (
              <div className="shrink-0 px-4 pb-3 sm:px-6">
                <button
                  ref={deleteTriggerRef}
                  type="button"
                  aria-haspopup="dialog"
                  onClick={requestDelete}
                  className="min-h-11 rounded-md px-2 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 disabled:opacity-50"
                >
                  Usuń leada
                </button>
              </div>
            )}
          </fieldset>
        </div>
      )}
      {canDelete && (
        <dialog
          ref={deleteDialogRef}
          aria-labelledby="lead-delete-title"
          aria-describedby="lead-delete-description"
          aria-busy={deleting}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.stopPropagation();
          }}
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            cancelDelete();
          }}
          className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-zinc-950/30 sm:p-6"
        >
          <h2 id="lead-delete-title" className="text-lg font-semibold">
            Usuń leada
          </h2>
          <p id="lead-delete-description" className="mt-2 text-sm leading-6 [overflow-wrap:anywhere]">
            Lead <strong>{lead.company_name}</strong> i jego aktywności zostaną trwale usunięte. Tej operacji nie można cofnąć.
          </p>
          {deleteError && (
            <p role="alert" className="mt-3 text-sm leading-6 text-red-800">
              {deleteError}
            </p>
          )}
          <div
            className="mx-auto mt-5 grid w-full gap-2"
            style={{ maxWidth: "16rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
          >
            <button
              type="button"
              autoFocus
              disabled={deleting}
              onClick={cancelDelete}
              className={`${optionClass} min-w-0 break-words text-center`}
            >
              Anuluj
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={confirmDelete}
              style={{ backgroundColor: "#991b1b" }}
              className="min-h-10 min-w-0 break-words rounded-lg px-3 py-2 text-center text-sm font-semibold text-white hover:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 disabled:opacity-50"
            >
              {deleting ? "Usuwanie…" : "Usuń na stałe"}
            </button>
          </div>
        </dialog>
      )}
    </dialog>
  );
}
