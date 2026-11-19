import { redirect } from "next/navigation";
import { getAuthenticatedClaims } from "@/lib/auth/session";
import {
  ACTIVE_LEAD_STATUSES,
  type FollowUpLead,
} from "@/lib/leads/follow-ups";
import { isValidDateOnly } from "@/lib/leads/dates";
import { createClient } from "@/lib/supabase/server";
import type { CalendarRange } from "@/lib/leads/calendar";

export async function getFollowUpLeads(
  ...scope: [destination?: "/follow-ups"] | [destination: "/calendar", range: CalendarRange]
): Promise<{ ok: true; leads: FollowUpLead[] } | { ok: false }> {
  const [destination = "/follow-ups", range] = scope;
  const claims = await getAuthenticatedClaims();
  if (!claims) redirect(`/login?next=${encodeURIComponent(destination)}`);
  try {
    const supabase = await createClient();
    const leads: FollowUpLead[] = [];
    let offset = 0;
    let total = 1;
    while (offset < total) {
      let query = supabase
        .schema("public")
        .from("leads")
        .select("id, updated_at, company_name, status, follow_up_date, next_step", {
          count: "exact",
        })
        .eq("user_id", claims.sub)
        .in("status", ACTIVE_LEAD_STATUSES);
      // Porównania DATE wykluczają NULL i obejmują oba krańce siatki.
      if (range) query = query.gte("follow_up_date", range.from).lte("follow_up_date", range.to);
      const { data, error, count } = await query
        .order("follow_up_date", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(offset, offset + 499)
        .overrideTypes<FollowUpLead[], { merge: false }>();
      if (
        error ||
        data === null ||
        count === null ||
        (!data.length && offset < count)
      )
        return { ok: false };
      if (
        data.some(
          (lead) =>
            !ACTIVE_LEAD_STATUSES.some((status) => status === lead.status) ||
            (lead.follow_up_date !== null &&
              !isValidDateOnly(lead.follow_up_date)) ||
            (range && (lead.follow_up_date === null ||
              lead.follow_up_date < range.from || lead.follow_up_date > range.to)),
        )
      )
        return { ok: false };
      leads.push(...data);
      offset += data.length;
      total = count;
    }
    return { ok: true, leads };
  } catch {
    return { ok: false };
  }
}
