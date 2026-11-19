"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedClaims } from "@/lib/auth/session";
import { isLeadId } from "@/lib/leads/details";
import {
  ACTIVE_LEAD_STATUSES,
  validateFollowUp,
  type FollowUpResult,
} from "@/lib/leads/follow-ups";
import { createClient } from "@/lib/supabase/server";
import { isLeadVersion, LEAD_CONFLICT } from "@/lib/leads/version";

export async function saveFollowUp(
  leadId: string,
  formData: FormData,
): Promise<FollowUpResult> {
  try {
    const claims = await getAuthenticatedClaims();
    if (!claims)
      return {
        ok: false,
        message: "Sesja wygasła. Zaloguj się ponownie przed zapisaniem zmian.",
      };
    if (!isLeadId(leadId))
      return {
        ok: false,
        message: "Nie znaleziono leada lub nie masz do niego dostępu.",
      };
    const validated = validateFollowUp(formData);
    if (!validated.ok) return validated;
    const expectedVersion = formData.get("expected_updated_at");
    if (!isLeadVersion(expectedVersion)) return LEAD_CONFLICT;
    const payload: { follow_up_date: string | null; last_contact_at?: string } =
      { follow_up_date: validated.date };
    if (validated.mode === "complete")
      payload.last_contact_at = new Date().toISOString();
    const supabase = await createClient();
    // Jeden UPDATE zapisuje atomowo kontakt i termin. Filtr statusu chroni też
    // przed równoczesnym zamknięciem leada w innym oknie.
    const { data, error } = await supabase
      .schema("public")
      .from("leads")
      .update(payload)
      .eq("id", leadId)
      .eq("user_id", claims.sub)
      .eq("updated_at", expectedVersion)
      .in("status", ACTIVE_LEAD_STATUSES)
      .select("id")
      .maybeSingle()
      .overrideTypes<{ id: string }, { merge: false }>();
    if (error)
      return {
        ok: false,
        message:
          "Nie udało się zapisać follow-upu. Wybrany termin został zachowany — spróbuj ponownie.",
      };
    if (!data) return LEAD_CONFLICT;
  } catch {
    return {
      ok: false,
      message:
        "Nie udało się zapisać follow-upu. Sprawdź połączenie i spróbuj ponownie.",
    };
  }
  for (const path of ["/follow-ups", "/pipeline", "/calendar"]) {
    try {
      revalidatePath(path);
    } catch {
      /* Klient odświeży bieżący widok. */
    }
  }
  return { ok: true };
}
