import { isValidDateOnly } from "@/lib/leads/dates";
import { isLeadId } from "@/lib/leads/details";
import { isLeadStatus, type LeadStatus } from "@/lib/leads/statuses";
import { isLeadVersion } from "@/lib/leads/version";

export type LeadStatusSnapshot = {
  id: string;
  updated_at: string;
  status: LeadStatus;
  follow_up_date: string | null;
};
export type MoveLeadInput = {
  status: LeadStatus;
  expectedUpdatedAt: string;
  expectedStatus: LeadStatus;
  expectedFollowUpDate: string | null;
  clearFollowUpConfirmed: boolean;
};
export type MoveLeadResult =
  | { ok: true; lead: LeadStatusSnapshot }
  | { ok: false; message: string; conflict?: true };

export function validateLeadMove(
  leadId: unknown,
  input: unknown,
): input is MoveLeadInput {
  if (!isLeadId(leadId) || !input || typeof input !== "object") return false;
  const values = input as Record<string, unknown>;
  return (
    isLeadStatus(values.status) &&
    isLeadVersion(values.expectedUpdatedAt) &&
    isLeadStatus(values.expectedStatus) &&
    (values.expectedFollowUpDate === null ||
      (typeof values.expectedFollowUpDate === "string" &&
        isValidDateOnly(values.expectedFollowUpDate))) &&
    typeof values.clearFollowUpConfirmed === "boolean"
  );
}
