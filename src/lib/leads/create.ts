import { isValidDateOnly } from "@/lib/leads/dates";
import {
  isClosedLeadStatus,
  isLeadStatus,
  type LeadStatus,
} from "@/lib/leads/statuses";

export const CONTACT_TYPES = [
  { value: "instagram", label: "Instagram", placeholder: "@nazwafirmy" },
  { value: "email", label: "E-mail", placeholder: "kontakt@firma.pl" },
  { value: "phone", label: "Telefon", placeholder: "500 600 700" },
] as const;

export type ContactType = (typeof CONTACT_TYPES)[number]["value"];
export type CreateLeadValues = {
  company_name: string;
  contact_type: ContactType;
  contact_value: string;
  status: LeadStatus;
  follow_up_date: string;
};
export type LeadFieldErrors = Partial<Record<keyof CreateLeadValues, string>>;
export type CreateLeadResult =
  | { ok: true; lead: { id: string } }
  | { ok: false; message?: string; fieldErrors?: LeadFieldErrors };

export function emptyLeadValues(): CreateLeadValues {
  return {
    company_name: "",
    contact_type: "instagram",
    contact_value: "",
    status: "new",
    follow_up_date: "",
  };
}

export function updateLeadStatus(
  values: CreateLeadValues,
  status: LeadStatus,
): CreateLeadValues {
  return {
    ...values,
    status,
    follow_up_date: isClosedLeadStatus(status) ? "" : values.follow_up_date,
  };
}

export function validateCreateLead(
  formData: FormData,
):
  | { ok: true; values: CreateLeadValues }
  | { ok: false; fieldErrors: LeadFieldErrors } {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const company = text("company_name").replace(/\s+/g, " ");
  const contactType = text("contact_type");
  const contact = text("contact_value");
  const status = text("status");
  const date = text("follow_up_date");
  const errors: LeadFieldErrors = {};
  if (!company) errors.company_name = "Wpisz nazwę firmy.";
  if (!CONTACT_TYPES.some((type) => type.value === contactType))
    errors.contact_type = "Wybierz Instagram, e-mail albo telefon.";
  if (!contact) errors.contact_value = "Wpisz jedną formę kontaktu.";
  else if (
    contactType === "email" &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)
  )
    errors.contact_value = "Wpisz poprawny adres e-mail.";
  if (!isLeadStatus(status)) errors.status = "Wybierz poprawny status.";
  if (date && !isValidDateOnly(date))
    errors.follow_up_date = "Wybierz poprawną datę w kalendarzu.";
  if (Object.keys(errors).length || !isLeadStatus(status))
    return { ok: false, fieldErrors: errors };

  return {
    ok: true,
    values: {
      company_name: company,
      contact_type: contactType as ContactType,
      contact_value: contact,
      status,
      follow_up_date: isClosedLeadStatus(status) ? "" : date,
    },
  };
}
