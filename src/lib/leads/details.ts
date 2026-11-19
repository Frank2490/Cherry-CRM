import type { PipelineLead } from "@/lib/leads/pipeline";
import { isValidDateOnly } from "@/lib/leads/dates";
import {
  isClosedLeadStatus,
  isLeadStatus,
  type LeadStatus,
} from "@/lib/leads/statuses";

export type LeadDetails = PipelineLead & {
  next_step: string | null;
  notes: string | null;
  created_at: string;
  last_contact_at: string | null;
};

// Jawna projekcja bez user_id i bez historii kontaktów.
export const leadDetailColumns =
  "id, updated_at, company_name, instagram, email, phone, status, service_type, estimated_value, follow_up_date, next_step, notes, created_at, last_contact_at";

export type LeadEditValues = {
  company_name: string;
  instagram: string;
  email: string;
  phone: string;
  status: LeadStatus;
  service_type: string;
  estimated_value: string;
  follow_up_date: string;
  next_step: string;
  notes: string;
};
export type LeadEditErrors = Partial<
  Record<keyof LeadEditValues | "contacts", string>
>;
export type LeadDetailsResult =
  | { ok: true; lead: LeadDetails }
  | { ok: false; message: string };
export type UpdateLeadResult =
  | { ok: true; lead: LeadDetails; revalidated?: true }
  | {
      ok: false;
      message?: string;
      fieldErrors?: LeadEditErrors;
      conflict?: true;
    };

export function isLeadId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function leadEditValues(lead: LeadDetails): LeadEditValues {
  return {
    company_name: lead.company_name,
    instagram: lead.instagram ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    status: lead.status,
    service_type: lead.service_type ?? "",
    estimated_value:
      lead.estimated_value === null ? "" : String(lead.estimated_value),
    follow_up_date: lead.follow_up_date ?? "",
    next_step: lead.next_step ?? "",
    notes: lead.notes ?? "",
  };
}

export function hasLeadChanges(values: LeadEditValues, saved: LeadDetails) {
  const baseline = leadEditValues(saved);
  return (Object.keys(baseline) as (keyof LeadEditValues)[]).some(
    (field) => values[field] !== baseline[field],
  );
}

export function changeEditStatus(
  values: LeadEditValues,
  status: LeadStatus,
): LeadEditValues {
  return {
    ...values,
    status,
    follow_up_date: isClosedLeadStatus(status) ? "" : values.follow_up_date,
  };
}

export function validateLeadUpdate(formData: FormData):
  | {
      ok: true;
      payload: Omit<LeadEditValues, "estimated_value" | "follow_up_date"> & {
        estimated_value: string | null;
        follow_up_date: string | null;
      };
    }
  | { ok: false; fieldErrors: LeadEditErrors } {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const company = text("company_name").replace(/\s+/g, " ");
  const instagram = text("instagram");
  const email = text("email");
  const phone = text("phone");
  const status = text("status");
  const date = text("follow_up_date");
  const amount = text("estimated_value").replace(",", ".");
  const errors: LeadEditErrors = {};
  if (!company) errors.company_name = "Wpisz nazwę firmy.";
  if (!instagram && !email && !phone)
    errors.contacts = "Podaj przynajmniej jedną formę kontaktu.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = "Wpisz poprawny adres e-mail.";
  if (!isLeadStatus(status)) errors.status = "Wybierz poprawny status.";
  if (date && !isValidDateOnly(date))
    errors.follow_up_date = "Wybierz poprawną datę w kalendarzu.";
  if (amount && !/^\d{1,10}(?:\.\d{1,2})?$/.test(amount))
    errors.estimated_value =
      "Podaj kwotę od 0 do 9 999 999 999,99 PLN, z maksymalnie dwoma miejscami po przecinku.";
  if (Object.keys(errors).length || !isLeadStatus(status))
    return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    payload: {
      company_name: company,
      instagram,
      email,
      phone,
      status,
      service_type: text("service_type"),
      estimated_value: amount || null,
      follow_up_date: isClosedLeadStatus(status) ? null : date || null,
      next_step: text("next_step"),
      notes: text("notes"),
    },
  };
}
