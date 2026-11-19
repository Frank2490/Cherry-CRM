"use server";

import { getAuthenticatedClaims } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isLeadId } from "@/lib/leads/details";
import {
  activityColumns,
  validateActivity,
  type ActivitiesResult,
  type AddActivityResult,
  type LeadActivity,
} from "@/lib/leads/activities";

const unavailable = "Nie znaleziono leada lub nie masz do niego dostępu.";
type OwnedLead = { id: string; last_contact_at: string | null };

export async function getLeadActivities(
  leadId: string,
): Promise<ActivitiesResult> {
  try {
    const claims = await getAuthenticatedClaims();
    if (!claims)
      return {
        ok: false,
        message: "Sesja wygasła. Zaloguj się ponownie, aby odczytać historię.",
      };
    if (!isLeadId(leadId)) return { ok: false, message: unavailable };
    const supabase = await createClient();
    const owner = await supabase
      .schema("public")
      .from("leads")
      .select("id, last_contact_at")
      .eq("id", leadId)
      .eq("user_id", claims.sub)
      .maybeSingle()
      .overrideTypes<OwnedLead, { merge: false }>();
    if (owner.error)
      return {
        ok: false,
        message: "Nie udało się pobrać historii. Spróbuj ponownie.",
      };
    if (!owner.data) return { ok: false, message: unavailable };
    const activities: LeadActivity[] = [];
    let offset = 0,
      total = 1;
    while (offset < total) {
      const { data, error, count } = await supabase
        .schema("public")
        .from("lead_activities")
        .select(activityColumns, { count: "exact" })
        .eq("lead_id", leadId)
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 499)
        .overrideTypes<LeadActivity[], { merge: false }>();
      if (error || !data || count === null || (!data.length && offset < count))
        return {
          ok: false,
          message: "Nie udało się pobrać historii. Spróbuj ponownie.",
        };
      activities.push(...data);
      offset += data.length;
      total = count;
    }
    return { ok: true, activities };
  } catch {
    return {
      ok: false,
      message:
        "Nie udało się pobrać historii. Sprawdź połączenie i spróbuj ponownie.",
    };
  }
}

export async function addLeadActivity(
  leadId: string,
  data: FormData,
): Promise<AddActivityResult> {
  try {
    const claims = await getAuthenticatedClaims();
    if (!claims)
      return {
        ok: false,
        message: "Sesja wygasła. Zaloguj się ponownie przed zapisaniem wpisu.",
      };
    if (!isLeadId(leadId)) return { ok: false, message: unavailable };
    const validated = validateActivity(data);
    if (!validated.ok) return validated;
    const supabase = await createClient();
    const owner = await supabase
      .schema("public")
      .from("leads")
      .select("id, last_contact_at")
      .eq("id", leadId)
      .eq("user_id", claims.sub)
      .maybeSingle()
      .overrideTypes<OwnedLead, { merge: false }>();
    if (owner.error)
      return {
        ok: false,
        message: "Nie udało się sprawdzić dostępu. Spróbuj ponownie.",
      };
    if (!owner.data) return { ok: false, message: unavailable };
    const payload = { ...validated.payload, lead_id: leadId };
    const inserted = await supabase
      .schema("public")
      .from("lead_activities")
      .insert(payload)
      .select(activityColumns)
      .single()
      .overrideTypes<LeadActivity, { merge: false }>();
    let activity = inserted.data;
    // Ten sam UUID przy ponowieniu po utracie odpowiedzi nie tworzy drugiego wpisu.
    if (inserted.error?.code === "23505") {
      const existing = await supabase
        .schema("public")
        .from("lead_activities")
        .select(activityColumns)
        .eq("lead_id", leadId)
        .eq("id", payload.id)
        .maybeSingle()
        .overrideTypes<LeadActivity, { merge: false }>();
      const row = existing.data;
      if (
        existing.error ||
        !row ||
        row.type !== payload.type ||
        row.content !== payload.content ||
        row.channel !== payload.channel
      )
        return {
          ok: false,
          message: "Nie udało się potwierdzić zapisu. Spróbuj ponownie.",
        };
      activity = row;
    } else if (inserted.error || !activity)
      return {
        ok: false,
        message:
          "Nie udało się zapisać wpisu. Tekst został zachowany — spróbuj ponownie.",
      };
    if (!activity)
      return {
        ok: false,
        message: "Nie udało się potwierdzić zapisu. Spróbuj ponownie.",
      };
    if (activity.type !== "contact") return { ok: true, activity };

    // INSERT jest już potwierdzony; nie zgłaszamy jego porażki z powodu błędu dodatkowego odczytu.
    const oldDate = owner.data.last_contact_at;
    let lastContactAt =
      oldDate && Date.parse(oldDate) > Date.parse(activity.occurred_at)
        ? oldDate
        : activity.occurred_at;
    try {
      const latest = await supabase
        .schema("public")
        .from("leads")
        .select("id, last_contact_at")
        .eq("id", leadId)
        .eq("user_id", claims.sub)
        .maybeSingle()
        .overrideTypes<OwnedLead, { merge: false }>();
      if (!latest.error && latest.data?.last_contact_at)
        lastContactAt = latest.data.last_contact_at;
    } catch {
      /* Zachowujemy potwierdzoną datę kontaktu; bazę aktualizuje istniejący trigger. */
    }
    return { ok: true, activity, lastContactAt };
  } catch {
    return {
      ok: false,
      message:
        "Nie udało się zapisać wpisu. Tekst został zachowany — sprawdź połączenie i spróbuj ponownie.",
    };
  }
}
