import { isLeadId } from "@/lib/leads/details";
import { isLeadStatus, LEAD_STATUSES } from "@/lib/leads/statuses";

export const ACTIVITY_TYPES = {
  note: "Notatka",
  contact: "Kontakt",
  status_change: "Zmiana statusu",
} as const;
export const CONTACT_CHANNELS = [
  { value: "instagram", label: "Instagram" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefon" },
  { value: "other", label: "Inne" },
] as const;
export type ActivityType = keyof typeof ACTIVITY_TYPES;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number]["value"];
export type LeadActivity = {
  id: string;
  lead_id: string;
  type: ActivityType;
  content: string;
  channel: ContactChannel | null;
  occurred_at: string;
};
export type ActivitiesResult =
  | { ok: true; activities: LeadActivity[] }
  | { ok: false; message: string };
export type AddActivityResult =
  | { ok: true; activity: LeadActivity; lastContactAt?: string | null }
  | { ok: false; message: string; field?: "content" | "channel" };
export type ActivityEditorState = { dirty: boolean; saving: boolean };
export const activityColumns =
  "id, lead_id, type, content, channel, occurred_at";

export function validateActivity(data: FormData) {
  const text = (key: string) => {
    const value = data.get(key);
    return typeof value === "string" ? value.trim() : "";
  };
  const type = text("type"),
    content = text("content"),
    channel = text("channel"),
    id = text("request_id");
  if (!isLeadId(id))
    return {
      ok: false as const,
      message: "Nie udało się przygotować zapisu. Spróbuj ponownie.",
    };
  if (type !== "note" && type !== "contact")
    return { ok: false as const, message: "Wybierz notatkę albo kontakt." };
  if (!content)
    return {
      ok: false as const,
      message: "Wpisz treść zdarzenia.",
      field: "content" as const,
    };
  if (
    type === "contact" &&
    !CONTACT_CHANNELS.some((item) => item.value === channel)
  )
    return {
      ok: false as const,
      message: "Wybierz kanał kontaktu.",
      field: "channel" as const,
    };
  return {
    ok: true as const,
    payload: {
      id,
      type,
      content,
      channel: type === "contact" ? (channel as ContactChannel) : null,
    },
  };
}

export function activityContent(activity: LeadActivity) {
  if (activity.type !== "status_change") return activity.content;
  try {
    const change: unknown = JSON.parse(activity.content);
    if (
      change &&
      typeof change === "object" &&
      "from_status" in change &&
      "to_status" in change &&
      isLeadStatus(change.from_status) &&
      isLeadStatus(change.to_status)
    ) {
      const label = (value: string) =>
        LEAD_STATUSES.find((status) => status.value === value)!.label;
      return `${label(change.from_status)} → ${label(change.to_status)}`;
    }
  } catch {
    /* Starsze wpisy tekstowe również pozostają czytelne. */
  }
  return activity.content;
}

export function mergeActivities(
  current: LeadActivity[],
  incoming: LeadActivity[],
) {
  const unique = new Map(
    [...current, ...incoming].map((activity) => [activity.id, activity]),
  );
  return [...unique.values()].sort(
    (a, b) =>
      Date.parse(b.occurred_at) - Date.parse(a.occurred_at) ||
      b.id.localeCompare(a.id),
  );
}
