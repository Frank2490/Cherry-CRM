import { redirect } from "next/navigation";
import { getAuthenticatedClaims } from "@/lib/auth/session";
import type { PipelineLead } from "@/lib/leads/pipeline";
import { isLeadStatus } from "@/lib/leads/statuses";
import { createClient } from "@/lib/supabase/server";

type PipelineResult =
  | { ok: true; leads: PipelineLead[] }
  | { ok: false };

const pipelineColumns =
  "id, updated_at, company_name, instagram, email, phone, status, service_type, estimated_value, follow_up_date";
const pageSize = 500;

export async function getPipelineLeads(): Promise<PipelineResult> {
  // Sprawdzenie przy odczycie danych, niezależne od ochrony wspólnego layoutu.
  const claims = await getAuthenticatedClaims();
  if (!claims) redirect("/login?next=%2Fpipeline");

  try {
    const supabase = await createClient();
    const leads: PipelineLead[] = [];
    let offset = 0;
    let total = 1;

    // Pobieramy kolejne zakresy, aby limit odpowiedzi API nie ucinał Pipeline.
    while (offset < total) {
      const { data, error, count } = await supabase
        .schema("public")
        .from("leads")
        .select(pipelineColumns, { count: "exact" })
        .eq("user_id", claims.sub)
        .order("follow_up_date", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1)
        .overrideTypes<PipelineLead[], { merge: false }>();

      if (error || data === null || count === null) return { ok: false };
      if (data.some((lead) => !isLeadStatus(lead.status))) return { ok: false };
      if (data.length === 0 && offset < count) return { ok: false };

      leads.push(...data);
      offset += data.length;
      total = count;
    }

    return { ok: true, leads };
  } catch {
    // Nie zwracamy częściowego wyniku ani pustej tablicy zamiast błędu.
    return { ok: false };
  }
}
