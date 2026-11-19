"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { addLeadActivity, getLeadActivities } from "@/app/actions/activities";
import {
  ACTIVITY_TYPES,
  CONTACT_CHANNELS,
  activityContent,
  mergeActivities,
  type ActivityEditorState,
  type ContactChannel,
  type LeadActivity,
} from "@/lib/leads/activities";

type Props = {
  leadId: string;
  revision: number;
  disabled: boolean;
  onStateChange: (state: ActivityEditorState) => void;
  onLastContact: (value: string | null) => void;
};
const controlClass =
  "mt-2 min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950 outline-none focus:border-[#734353] focus:ring-2 focus:ring-[#734353]/15 aria-invalid:border-red-700 disabled:bg-zinc-50";

export function LeadActivities({
  leadId,
  revision,
  disabled,
  onStateChange,
  onLastContact,
}: Props) {
  const [items, setItems] = useState<LeadActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<"note" | "contact">("note");
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [channel, setChannel] = useState<ContactChannel>("instagram");
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<"content" | "channel" | undefined>();
  const [success, setSuccess] = useState("");
  const [pending, startTransition] = useTransition();
  const saving = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestIds = useRef<
    Partial<Record<"note" | "contact", { signature: string; id: string }>>
  >({});

  useEffect(() => {
    let active = true;
    getLeadActivities(leadId)
      .then((result) => {
        if (!active) return;
        setLoading(false);
        if (result.ok) {
          setItems((previous) => mergeActivities(previous, result.activities));
          setLoadError("");
        } else setLoadError(result.message);
      })
      .catch(() => {
        if (active) {
          setLoading(false);
          setLoadError("Nie udało się pobrać historii. Spróbuj ponownie.");
        }
      });
    return () => {
      active = false;
    };
  }, [leadId, revision, retry]);

  function changeContent(value: string) {
    if (mode === "note") setNote(value);
    else setContact(value);
    setSuccess("");
    onStateChange({
      dirty: Boolean(mode === "note" ? value || contact : note || value),
      saving: false,
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || disabled) return;
    const content = mode === "note" ? note : contact;
    if (!content.trim()) {
      setError("Wpisz treść zdarzenia.");
      setInvalid("content");
      textareaRef.current?.focus();
      return;
    }
    const signature = JSON.stringify([
      content.trim(),
      mode === "contact" ? channel : null,
    ]);
    const request = requestIds.current[mode];
    const id =
      request?.signature === signature ? request.id : crypto.randomUUID();
    requestIds.current[mode] = { signature, id };
    const data = new FormData();
    data.set("request_id", id);
    data.set("type", mode);
    data.set("content", content);
    data.set("channel", channel);
    saving.current = true;
    onStateChange({ dirty: true, saving: true });
    setError("");
    setInvalid(undefined);
    setSuccess("");
    startTransition(async () => {
      try {
        const result = await addLeadActivity(leadId, data);
        if (result.ok) {
          setItems((previous) => mergeActivities(previous, [result.activity]));
          if (mode === "note") setNote("");
          else setContact("");
          delete requestIds.current[mode];
          if (result.lastContactAt !== undefined)
            onLastContact(result.lastContactAt);
          setSuccess(
            mode === "note"
              ? "Notatka została zapisana."
              : "Kontakt został zapisany.",
          );
          onStateChange({
            dirty: Boolean(mode === "note" ? contact : note),
            saving: false,
          });
        } else {
          setError(result.message);
          setInvalid(result.field);
          onStateChange({ dirty: true, saving: false });
        }
      } catch {
        setError(
          "Nie udało się zapisać wpisu. Tekst został zachowany — spróbuj ponownie.",
        );
        onStateChange({ dirty: true, saving: false });
      } finally {
        saving.current = false;
      }
    });
  }

  return (
    <section
      aria-labelledby="lead-history-title"
      className="border-t border-zinc-200 pt-5"
    >
      <h3
        id="lead-history-title"
        className="text-base font-semibold text-zinc-950"
      >
        Historia kontaktów
      </h3>
      <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
        <div
          className="mb-3 flex gap-2"
          role="group"
          aria-label="Rodzaj nowego wpisu"
        >
          {(
            [
              { type: "note", label: "Notatka" },
              { type: "contact", label: "Kontakt" },
            ] as const
          ).map((item) => (
            <button
              key={item.type}
              type="button"
              disabled={disabled || pending}
              aria-pressed={mode === item.type}
              onClick={() => {
                setMode(item.type);
                setError("");
                setInvalid(undefined);
                setSuccess("");
                textareaRef.current?.focus();
              }}
              className="min-h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-600 aria-pressed:border-[#542b39] aria-pressed:bg-[#faf5f7] aria-pressed:font-semibold aria-pressed:text-[#542b39] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900"
            >
              {item.label}
            </button>
          ))}
        </div>
        <form onSubmit={submit} noValidate aria-busy={pending}>
          <fieldset disabled={disabled || pending} className="min-w-0">
            <label
              htmlFor="lead-activity-content"
              className="text-sm font-medium"
            >
              {mode === "note" ? "Treść notatki" : "Krótki opis rozmowy"}
            </label>
            <textarea
              ref={textareaRef}
              id="lead-activity-content"
              name="content"
              rows={2}
              value={mode === "note" ? note : contact}
              onChange={(event) => changeContent(event.target.value)}
              aria-required="true"
              aria-invalid={invalid === "content"}
              aria-describedby={error ? "lead-activity-error" : undefined}
              className={`${controlClass} resize-y`}
            />
            {mode === "contact" && (
              <div className="mt-3">
                <label
                  htmlFor="lead-activity-channel"
                  className="text-sm font-medium"
                >
                  Kanał kontaktu
                </label>
                <div className="relative mt-2">
                  <select
                    id="lead-activity-channel"
                    name="channel"
                    value={channel}
                    onChange={(event) => {
                      const next = CONTACT_CHANNELS.find(
                        (item) => item.value === event.target.value,
                      );
                      if (next) setChannel(next.value);
                    }}
                    aria-invalid={invalid === "channel"}
                    aria-describedby={error ? "lead-activity-error" : undefined}
                    className={`${controlClass} mt-0 appearance-none pr-10`}
                  >
                    {CONTACT_CHANNELS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
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
              </div>
            )}
            {error && (
              <p
                id="lead-activity-error"
                role="alert"
                className="mt-3 text-sm leading-6 text-red-800"
              >
                {error}
              </p>
            )}
            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                className="min-h-10 rounded-lg bg-[#542b39] px-4 text-sm font-semibold text-white hover:bg-[#43222d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 disabled:opacity-50"
              >
                {pending
                  ? "Zapisywanie…"
                  : mode === "note"
                    ? "Zapisz"
                    : "Zapisz kontakt"}
              </button>
            </div>
          </fieldset>
        </form>
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-sm text-green-800"
        >
          {success}
        </p>
      </div>

      {loading && (
        <p role="status" className="mt-4 text-sm text-zinc-500">
          Ładowanie historii…
        </p>
      )}
      {loadError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <p role="alert" className="text-sm text-red-800">
            {loadError}
          </p>
          <button
            type="button"
            disabled={disabled || pending}
            onClick={() => {
              setLoadError("");
              setLoading(true);
              setRetry((value) => value + 1);
            }}
            className="mt-2 min-h-10 rounded-md px-2 text-sm font-medium text-[#734353] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-rose-900"
          >
            Wczytaj historię ponownie
          </button>
        </div>
      )}
      {!loading && !loadError && items.length === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-zinc-300 px-3 py-5 text-center text-sm text-zinc-500">
          Nie ma jeszcze wpisów w historii.
        </p>
      )}
      {items.length > 0 && (
        <ol
          className="mt-4 space-y-3"
          aria-label="Historia leada, od najnowszych zdarzeń"
        >
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-zinc-200 bg-white p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs leading-5">
                <p className="font-semibold text-[#734353]">
                  {ACTIVITY_TYPES[item.type]}
                  {item.type === "contact" && item.channel && (
                    <span className="font-normal text-zinc-500">
                      {" "}
                      ·{" "}
                      {
                        CONTACT_CHANNELS.find(
                          (entry) => entry.value === item.channel,
                        )?.label
                      }
                    </span>
                  )}
                </p>
                <time dateTime={item.occurred_at} className="text-zinc-500">
                  {new Intl.DateTimeFormat("pl-PL", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(item.occurred_at))}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700 [overflow-wrap:anywhere]">
                {activityContent(item)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
