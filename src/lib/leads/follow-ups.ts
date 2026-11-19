import { isValidDateOnly } from "@/lib/leads/dates";
export { followUpQuickDate } from "@/lib/leads/dates";
import {
  LEAD_STATUSES,
  isClosedLeadStatus,
  type LeadStatus,
} from "@/lib/leads/statuses";

export type FollowUpLead = {
  id: string;
  updated_at: string;
  company_name: string;
  status: LeadStatus;
  follow_up_date: string | null;
  next_step: string | null;
};
export const ACTIVE_LEAD_STATUSES = LEAD_STATUSES.filter(
  (status) => !isClosedLeadStatus(status.value),
).map((status) => status.value);
export const FOLLOW_UP_SECTIONS = [
  { key: "overdue", label: "Zaległe", empty: "Nie masz zaległych kontaktów." },
  {
    key: "today",
    label: "Na dziś",
    empty: "Nie masz kontaktów zaplanowanych na dziś.",
  },
  {
    key: "upcoming",
    label: "Nadchodzące",
    empty: "Nie masz kolejnych zaplanowanych terminów.",
  },
  {
    key: "unscheduled",
    label: "Bez terminu",
    empty: "Wszyscy aktywni klienci mają ustalony termin.",
  },
] as const;

export function groupFollowUps(leads: FollowUpLead[], today: string) {
  const active = leads.filter((lead) => !isClosedLeadStatus(lead.status));
  return FOLLOW_UP_SECTIONS.map((section) => ({
    ...section,
    leads: active
      .filter((lead) => {
        const date = lead.follow_up_date;
        if (date === null) return section.key === "unscheduled";
        if (date < today) return section.key === "overdue";
        if (date === today) return section.key === "today";
        return section.key === "upcoming";
      })
      .sort(
        (a, b) =>
          (a.follow_up_date ?? "").localeCompare(b.follow_up_date ?? "") ||
          a.id.localeCompare(b.id),
      ),
  }));
}
export type FollowUpMode = "complete" | "reschedule";
export type FollowUpResult =
  | { ok: true }
  | { ok: false; message: string; conflict?: true };
export function validateFollowUp(
  formData: FormData,
):
  | { ok: true; mode: FollowUpMode; date: string | null }
  | { ok: false; message: string } {
  const mode = formData.get("mode");
  const raw = formData.get("follow_up_date");
  if (mode !== "complete" && mode !== "reschedule")
    return { ok: false, message: "Wybierz poprawne działanie." };
  if (typeof raw !== "string" || (raw.trim() && !isValidDateOnly(raw.trim())))
    return {
      ok: false,
      message: "Wybierz poprawną datę lub opcję Bez terminu.",
    };
  return { ok: true, mode, date: raw.trim() || null };
}
