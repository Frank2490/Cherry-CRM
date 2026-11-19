// color oznacza dotychczasowy akcent; textColor służy wyłącznie napisom.
export const LEAD_STATUSES = [
  { value: "new", label: "Nowy", color: "#64748b", textColor: "#64748b" },
  { value: "interested", label: "Zainteresowany", color: "#2563eb", textColor: "#2563eb" },
  {
    value: "visualization_sent",
    label: "Wizualizacja wysłana",
    color: "#7c3aed",
    textColor: "#7c3aed",
  },
  { value: "proposal", label: "Wycena / oferta", color: "#ea580c", textColor: "#c2410c" },
  { value: "decision", label: "Decyzja", color: "#0891b2", textColor: "#0e7490" },
  { value: "won", label: "Wygrany", color: "#16a34a", textColor: "#15803d" },
  { value: "lost", label: "Przegrany", color: "#dc2626", textColor: "#dc2626" },
] as const;

export type LeadStatusConfig = (typeof LEAD_STATUSES)[number];
export type LeadStatus = LeadStatusConfig["value"];

export function isLeadStatus(value: unknown): value is LeadStatus {
  return LEAD_STATUSES.some((status) => status.value === value);
}

export function isClosedLeadStatus(value: LeadStatus) {
  return value === "won" || value === "lost";
}
