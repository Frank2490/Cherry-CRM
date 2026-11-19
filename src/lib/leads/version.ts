import { isValidDateOnly } from "@/lib/leads/dates";

export const LEAD_CONFLICT_MESSAGE =
  "Dane tego klienta zostały zmienione w innym oknie. Odśwież je przed zapisem.";

export const LEAD_CONFLICT = {
  ok: false,
  conflict: true,
  message: LEAD_CONFLICT_MESSAGE,
} as const;

export function isLeadVersion(value: unknown): value is string {
  // Zachowujemy oryginalny TIMESTAMPTZ, w tym mikrosekundy PostgreSQL.
  // Konwersja przez Date/toISOString() utraciłaby część precyzji wersji.
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) &&
    isValidDateOnly(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  );
}
