"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { createLead } from "@/app/actions/leads";
import { FollowUpCalendar } from "@/components/pipeline/follow-up-calendar";
import { SectionIcon } from "@/components/section-icon";
import { isDialogBackdropClick, useUnsavedChanges } from "@/lib/navigation/use-unsaved-changes";
import {
  CONTACT_TYPES,
  emptyLeadValues,
  updateLeadStatus,
  type CreateLeadResult,
  type LeadFieldErrors,
} from "@/lib/leads/create";
import { FOLLOW_UP_QUICK_DATES, followUpQuickDate } from "@/lib/leads/dates";
import { formatFollowUpDate } from "@/lib/leads/pipeline";
import {
  isClosedLeadStatus,
  isLeadStatus,
  LEAD_STATUSES,
} from "@/lib/leads/statuses";

const inputClass =
  "mt-2 min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none focus:border-[#734353] focus:ring-2 focus:ring-[#734353]/15 aria-invalid:border-red-700 disabled:bg-zinc-50";
const optionClass =
  "min-h-10 rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 disabled:opacity-50";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-2 text-sm text-red-800">
      {message}
    </p>
  ) : null;
}

export function AddLeadDialog() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const companyRef = useRef<HTMLInputElement>(null);
  const calendarTriggerRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const saving = useRef(false);
  const creationRequestId = useRef<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [values, setValues] = useState(emptyLeadValues);
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const empty = emptyLeadValues();
  const dirty = isOpen && (Object.keys(empty) as (keyof typeof empty)[])
    .some((field) => values[field] !== empty[field]);
  const confirmDiscard = useUnsavedChanges(dirty, pending);
  const closed = isClosedLeadStatus(values.status);
  const contact = CONTACT_TYPES.find(
    (type) => type.value === values.contact_type,
  )!;
  const status = LEAD_STATUSES.find((entry) => entry.value === values.status)!;

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    companyRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  function openDialog() {
    if (isOpen) return;
    // Niepotwierdzony zapis pozostaje tą samą operacją także po ponownym
    // otwarciu formularza. Zachowujemy jego szkic oraz identyfikator.
    if (!creationRequestId.current) {
      setValues(emptyLeadValues());
      setErrors({});
      setMessage("");
    }
    setSuccess("");
    setCalendarOpen(false);
    setIsOpen(true);
  }

  function finishClose() {
    dialogRef.current?.close();
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function closeDialog() {
    if (saving.current || !confirmDiscard()) return;
    finishClose();
    setValues(emptyLeadValues());
    setErrors({});
    setMessage("");
    setCalendarOpen(false);
    creationRequestId.current = null;
  }

  function selectDate(value: string) {
    setValues((previous) => ({ ...previous, follow_up_date: value }));
    setCalendarOpen(false);
    calendarTriggerRef.current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const data = new FormData(event.currentTarget);
    creationRequestId.current ??= crypto.randomUUID();
    data.set("creation_request_id", creationRequestId.current);
    saving.current = true;
    setMessage("");
    setErrors({});
    startTransition(async () => {
      let result: CreateLeadResult;
      try {
        result = await createLead(data);
      } catch {
        result = {
          ok: false,
          message:
            "Nie udało się zapisać leada. Dane zostały zachowane — spróbuj ponownie.",
        };
      }
      saving.current = false;
      if (result.ok) {
        creationRequestId.current = null;
        finishClose();
        setValues(emptyLeadValues());
        setCalendarOpen(false);
        setSuccess("Lead został dodany.");
        router.refresh();
      } else {
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

  return (
    <div className="shrink-0 sm:text-right">
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#542b39] px-4 text-sm font-semibold text-white hover:bg-[#43222d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900"
      >
        + Dodaj leada
      </button>
      <p
        role="status"
        aria-live="polite"
        className="mt-2 text-sm text-green-800"
      >
        {success}
      </p>

      {isOpen && (
        <dialog
          ref={dialogRef}
          aria-labelledby="add-lead-title"
          aria-describedby="add-lead-description"
          onClick={(event) => {
            if (isDialogBackdropClick(event)) closeDialog();
          }}
          onCancel={(event) => {
            event.preventDefault();
            closeDialog();
          }}
          onClose={() => {
            // close może dotrzeć po ponownym showModal w React Strict Mode.
            if (dialogRef.current?.open) return;
            setIsOpen(false);
            triggerRef.current?.focus();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && calendarOpen) {
              event.preventDefault();
              event.stopPropagation();
              setCalendarOpen(false);
              calendarTriggerRef.current?.focus();
            }
          }}
          className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-zinc-200 bg-white p-0 text-left text-zinc-900 shadow-xl backdrop:bg-zinc-950/45"
        >
          <div className="p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2
                  id="add-lead-title"
                  className="text-xl font-semibold tracking-tight"
                >
                  Dodaj leada
                </h2>
                <p
                  id="add-lead-description"
                  className="mt-2 text-sm leading-6 text-zinc-500"
                >
                  Wystarczą nazwa firmy i jeden kontakt.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                disabled={pending}
                aria-label="Zamknij formularz"
                className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-2xl text-zinc-500 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-rose-900 disabled:opacity-40"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={submit}
              noValidate
              aria-busy={pending}
              className="mt-6"
            >
              <fieldset disabled={pending} className="min-w-0 space-y-5">
                <div>
                  <label htmlFor="lead-company" className="text-sm font-medium">
                    Nazwa firmy
                  </label>
                  <input
                    ref={companyRef}
                    id="lead-company"
                    name="company_name"
                    value={values.company_name}
                    onChange={(event) =>
                      setValues({ ...values, company_name: event.target.value })
                    }
                    required
                    autoComplete="off"
                    placeholder="np. Studio Metamorfoza"
                    aria-invalid={Boolean(errors.company_name)}
                    aria-describedby={
                      errors.company_name ? "lead-company-error" : undefined
                    }
                    className={inputClass}
                  />
                  <FieldError
                    id="lead-company-error"
                    message={errors.company_name}
                  />
                </div>

                <fieldset>
                  <legend className="text-sm font-medium">
                    Dane kontaktowe
                  </legend>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {CONTACT_TYPES.map((type) => (
                      <label
                        key={type.value}
                        className="min-w-0 cursor-pointer"
                      >
                        <input
                          type="radio"
                          name="contact_type"
                          value={type.value}
                          checked={values.contact_type === type.value}
                          onChange={() =>
                            setValues({ ...values, contact_type: type.value })
                          }
                          className="peer sr-only"
                        />
                        <span className="flex min-h-11 items-center justify-center rounded-lg border border-zinc-200 px-2 text-sm text-zinc-600 peer-checked:border-[#542b39] peer-checked:bg-[#faf5f7] peer-checked:font-semibold peer-checked:text-[#542b39] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-rose-900">
                          {type.label}
                        </span>
                      </label>
                    ))}
                  </div>
                  <FieldError
                    id="lead-contact-type-error"
                    message={errors.contact_type}
                  />
                  <label htmlFor="lead-contact" className="sr-only">
                    {contact.label}
                  </label>
                  <input
                    id="lead-contact"
                    name="contact_value"
                    value={values.contact_value}
                    onChange={(event) =>
                      setValues({
                        ...values,
                        contact_value: event.target.value,
                      })
                    }
                    type={
                      values.contact_type === "email"
                        ? "email"
                        : values.contact_type === "phone"
                          ? "tel"
                          : "text"
                    }
                    required
                    autoComplete="off"
                    spellCheck={false}
                    autoCapitalize="none"
                    placeholder={contact.placeholder}
                    aria-invalid={Boolean(errors.contact_value)}
                    aria-describedby={
                      errors.contact_value ? "lead-contact-error" : undefined
                    }
                    className={inputClass}
                  />
                  <FieldError
                    id="lead-contact-error"
                    message={errors.contact_value}
                  />
                </fieldset>

                <div>
                  <label htmlFor="lead-status" className="text-sm font-medium">
                    Status
                  </label>
                  <div className="relative mt-2">
                    <select
                      id="lead-status"
                      name="status"
                      value={values.status}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (!isLeadStatus(next)) return;
                        setValues((previous) =>
                          updateLeadStatus(previous, next),
                        );
                        if (isClosedLeadStatus(next)) setCalendarOpen(false);
                      }}
                      aria-invalid={Boolean(errors.status)}
                      aria-describedby={
                        errors.status ? "lead-status-error" : undefined
                      }
                      className={`${inputClass} mt-0 appearance-none border-l-4 pl-3 pr-10`}
                      style={{ borderLeftColor: status.color }}
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
                  <FieldError id="lead-status-error" message={errors.status} />
                </div>

                <fieldset disabled={pending || closed}>
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
                  <div className="mt-2 flex min-h-6 flex-wrap items-center justify-between gap-2 text-sm">
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
                          className={`${optionClass} border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 aria-pressed:border-[#542b39] aria-pressed:bg-[#faf5f7] aria-pressed:font-semibold aria-pressed:text-[#542b39]`}
                        >
                          {option.label}
                        </button>
                      ))}
                      <button
                        ref={calendarTriggerRef}
                        type="button"
                        onClick={() => setCalendarOpen(!calendarOpen)}
                        aria-expanded={calendarOpen}
                        aria-controls="lead-follow-up-calendar"
                        data-invalid={Boolean(errors.follow_up_date)}
                        aria-describedby={
                          errors.follow_up_date ? "lead-date-error" : undefined
                        }
                        className={`${optionClass} flex items-center gap-2 ${calendarOpen ? "border-[#542b39] bg-[#faf5f7] text-[#542b39]" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}
                      >
                        <SectionIcon name="calendar" className="size-4" />{" "}
                        Wybierz datę
                      </button>
                    </div>
                  )}
                  <FieldError
                    id="lead-date-error"
                    message={errors.follow_up_date}
                  />
                  {calendarOpen && !closed && (
                    <div id="lead-follow-up-calendar">
                      <FollowUpCalendar
                        value={values.follow_up_date}
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
                    className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-900 outline-none"
                  >
                    {message}
                  </p>
                )}

                <div className="flex items-center justify-end gap-3 border-t border-zinc-100 pt-5">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="min-h-11 rounded-lg px-4 text-sm font-medium text-zinc-600 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-rose-900"
                  >
                    Anuluj
                  </button>
                  <button
                    type="submit"
                    className="min-h-11 rounded-lg bg-[#542b39] px-5 text-sm font-semibold text-white hover:bg-[#43222d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 disabled:cursor-wait disabled:opacity-60"
                  >
                    {pending ? "Zapisywanie…" : "Dodaj leada"}
                  </button>
                </div>
              </fieldset>
            </form>
          </div>
        </dialog>
      )}
    </div>
  );
}
