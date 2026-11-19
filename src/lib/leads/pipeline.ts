import { LEAD_STATUSES, type LeadStatus } from "@/lib/leads/statuses";
export { formatFollowUpDate, getTodayInWarsaw } from "@/lib/leads/dates";

// Wyłącznie kolumny odczytywane przez Pipeline; zgodne z migracją etapu 2B.
export type PipelineLead = {
  id: string;
  updated_at: string;
  company_name: string;
  instagram: string | null;
  email: string | null;
  phone: string | null;
  status: LeadStatus;
  service_type: string | null;
  estimated_value: number | null;
  follow_up_date: string | null;
};

export function groupPipelineLeads(leads: PipelineLead[]) {
  return LEAD_STATUSES.map((status) => ({
    status,
    leads: leads
      .filter((lead) => lead.status === status.value)
      .sort((a, b) => {
        if (status.value !== "won" && status.value !== "lost") {
          if (a.follow_up_date === null && b.follow_up_date !== null) return 1;
          if (b.follow_up_date === null && a.follow_up_date !== null) return -1;
          const dateOrder = (a.follow_up_date ?? "").localeCompare(
            b.follow_up_date ?? "",
          );
          if (dateOrder) return dateOrder;
        }
        return a.id.localeCompare(b.id);
      }),
  }));
}

export function getPrimaryContact(lead: PipelineLead) {
  const contacts = [
    { label: "Instagram", value: lead.instagram?.trim() },
    { label: "E-mail", value: lead.email?.trim() },
    { label: "Telefon", value: lead.phone?.trim() },
  ];
  return contacts.find((contact) => Boolean(contact.value)) ?? null;
}

export function isFollowUpOverdue(lead: PipelineLead, today: string) {
  return (
    lead.status !== "won" &&
    lead.status !== "lost" &&
    lead.follow_up_date !== null &&
    lead.follow_up_date < today
  );
}

export function formatEstimatedValue(value: number) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}
