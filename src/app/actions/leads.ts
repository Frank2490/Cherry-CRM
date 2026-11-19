"use server";

import { revalidatePath } from "next/cache";
import { getAuthenticatedClaims } from "@/lib/auth/session";
import { validateCreateLead, type CreateLeadResult } from "@/lib/leads/create";
import { createClient } from "@/lib/supabase/server";
import {
  isLeadId,
  leadDetailColumns,
  validateLeadUpdate,
  type LeadDetails,
  type LeadDetailsResult,
  type UpdateLeadResult,
} from "@/lib/leads/details";
import { isClosedLeadStatus, isLeadStatus } from "@/lib/leads/statuses";
import { isLeadVersion, LEAD_CONFLICT } from "@/lib/leads/version";
import {
  validateLeadMove,
  type LeadStatusSnapshot,
  type MoveLeadResult,
} from "@/lib/leads/move";

export async function moveLeadStatus(
  leadId: string,
  input: unknown,
): Promise<MoveLeadResult> {
  let saved: LeadStatusSnapshot;
  try {
    const claims = await getAuthenticatedClaims();
    if (!claims)
      return {
        ok: false,
        message: "Sesja wygasła. Zaloguj się ponownie przed zmianą statusu.",
      };
    if (!validateLeadMove(leadId, input))
      return { ok: false, message: "Nieprawidłowe dane zmiany statusu." };
    const supabase = await createClient();
    const { data: current, error: readError } = await supabase
      .schema("public")
      .from("leads")
      .select("id, updated_at, status, follow_up_date")
      .eq("id", leadId)
      .eq("user_id", claims.sub)
      .maybeSingle()
      .overrideTypes<LeadStatusSnapshot, { merge: false }>();
    if (readError)
      return {
        ok: false,
        message: "Nie udało się sprawdzić statusu leada. Spróbuj ponownie.",
      };
    if (!current || !isLeadStatus(current.status))
      return {
        ok: false,
        message: "Nie znaleziono leada lub nie masz do niego dostępu.",
      };
    if (
      current.updated_at !== input.expectedUpdatedAt ||
      current.status !== input.expectedStatus ||
      current.follow_up_date !== input.expectedFollowUpDate
    )
      return LEAD_CONFLICT;
    if (current.status === input.status) return { ok: true, lead: current };
    const closed = isClosedLeadStatus(input.status);
    if (closed && current.follow_up_date && !input.clearFollowUpConfirmed)
      return {
        ok: false,
        message:
          "Potwierdź usunięcie zaplanowanego follow-upu przed zamknięciem leada.",
      };
    // Odczyt powyżej służy potwierdzeniu usunięcia terminu. Ochrona zapisu
    // pozostaje atomowa: wersja jest warunkiem samego UPDATE, również po SELECT.
    let update = supabase
      .schema("public")
      .from("leads")
      .update({
        status: input.status,
        ...(closed ? { follow_up_date: null } : {}),
      })
      .eq("id", leadId)
      .eq("user_id", claims.sub)
      .eq("updated_at", input.expectedUpdatedAt)
      .eq("status", current.status);
    update =
      current.follow_up_date === null
        ? update.is("follow_up_date", null)
        : update.eq("follow_up_date", current.follow_up_date);
    const { data, error } = await update
      .select("id, updated_at, status, follow_up_date")
      .maybeSingle()
      .overrideTypes<LeadStatusSnapshot, { merge: false }>();
    if (error)
      return {
        ok: false,
        message:
          "Nie udało się zapisać statusu. Karta wróciła do poprzedniej kolumny — spróbuj ponownie.",
      };
    if (!data) return LEAD_CONFLICT;
    saved = data;
  } catch {
    return {
      ok: false,
      message:
        "Nie udało się zapisać statusu. Sprawdź połączenie i spróbuj ponownie.",
    };
  }
  for (const path of ["/pipeline", "/follow-ups", "/calendar"]) {
    try {
      revalidatePath(path);
    } catch {
      /* Zapis potwierdzony; klient odświeży dane. */
    }
  }
  return { ok: true, lead: saved };
}

export async function createLead(
  formData: FormData,
): Promise<CreateLeadResult> {
  let createdLead: { id: string };
  try {
    const claims = await getAuthenticatedClaims();
    if (!claims)
      return {
        ok: false,
        message: "Sesja wygasła. Zaloguj się ponownie przed zapisaniem leada.",
      };
    const validated = validateCreateLead(formData);
    if (!validated.ok) return validated;
    const requestId = formData.get("creation_request_id");
    if (!isLeadId(requestId))
      return {
        ok: false,
        message: "Nieprawidłowy identyfikator zapisu. Odśwież stronę i spróbuj ponownie.",
      };
    const values = validated.values;
    const supabase = await createClient();
    const { data, error } = await supabase
      .schema("public")
      .from("leads")
      .insert({
        company_name: values.company_name,
        instagram:
          values.contact_type === "instagram" ? values.contact_value : null,
        email: values.contact_type === "email" ? values.contact_value : null,
        phone: values.contact_type === "phone" ? values.contact_value : null,
        status: values.status,
        follow_up_date: values.follow_up_date || null,
        user_id: claims.sub,
        creation_request_id: requestId,
      })
      .select("id")
      .single()
      .overrideTypes<{ id: string }, { merge: false }>();

    if (error?.code === "23505") {
      // Unikalność w bazie rozstrzyga również równoczesne INSERT-y.
      // Ponowienie tylko odczytuje wcześniejszy wynik, bez UPDATE/upsertu.
      const existing = await supabase
        .schema("public")
        .from("leads")
        .select("id")
        .eq("user_id", claims.sub)
        .eq("creation_request_id", requestId)
        .maybeSingle()
        .overrideTypes<{ id: string }, { merge: false }>();
      if (existing.error || !existing.data?.id)
        return {
          ok: false,
          message: "Nie udało się potwierdzić zapisu. Dane zostały zachowane — spróbuj ponownie.",
        };
      createdLead = existing.data;
    } else if (error || !data?.id) {
      if (
        (error?.code === "42703" || error?.code === "PGRST204") &&
        error.message.includes("creation_request_id")
      )
        return {
          ok: false,
          message:
            "Baza wymaga aktualizacji ochrony przed podwójnym zapisem. Zastosuj migrację etapu 8B.3 i spróbuj ponownie.",
        };
      if (
        error?.code === "23514" &&
        error.message.includes("leads_follow_up_matches_status")
      ) {
        return {
          ok: false,
          message:
            "Baza wymaga jeszcze aktualizacji obsługi terminów. Zastosuj migrację etapu 3B i spróbuj ponownie.",
        };
      }
      return {
        ok: false,
        message:
          "Nie udało się zapisać leada. Dane zostały zachowane — spróbuj ponownie.",
      };
    } else createdLead = data;
  } catch {
    return {
      ok: false,
      message:
        "Nie udało się zapisać leada. Sprawdź połączenie i spróbuj ponownie.",
    };
  }

  // Zapis już się powiódł. Awaria odświeżania cache nie może sugerować ponownego INSERT.
  try {
    revalidatePath("/pipeline");
    revalidatePath("/follow-ups");
    revalidatePath("/calendar");
  } catch {
    /* Klient odświeży widok przez router.refresh(). */
  }
  return { ok: true, lead: createdLead };
}

export async function getLeadDetails(
  leadId: string,
): Promise<LeadDetailsResult> {
  try {
    const claims = await getAuthenticatedClaims();
    if (!claims)
      return {
        ok: false,
        message: "Sesja wygasła. Zaloguj się ponownie, aby otworzyć leada.",
      };
    if (!isLeadId(leadId))
      return {
        ok: false,
        message: "Nie znaleziono leada lub nie masz do niego dostępu.",
      };
    const supabase = await createClient();
    const { data, error } = await supabase
      .schema("public")
      .from("leads")
      .select(leadDetailColumns)
      .eq("id", leadId)
      .eq("user_id", claims.sub)
      .maybeSingle()
      .overrideTypes<LeadDetails, { merge: false }>();
    if (
      error &&
      (error.code === "42703" || error.code === "PGRST204") &&
      /\bnotes\b/.test(error.message)
    )
      return {
        ok: false,
        message:
          "Baza wymaga dodania pola Notatki. Zastosuj migrację etapu 4C i otwórz panel ponownie.",
      };
    if (error)
      return {
        ok: false,
        message: "Nie udało się pobrać danych leada. Spróbuj ponownie.",
      };
    if (!data || !isLeadStatus(data.status))
      return {
        ok: false,
        message: "Nie znaleziono leada lub nie masz do niego dostępu.",
      };
    return { ok: true, lead: data };
  } catch {
    return {
      ok: false,
      message:
        "Nie udało się pobrać danych leada. Sprawdź połączenie i spróbuj ponownie.",
    };
  }
}

export async function updateLead(
  leadId: string,
  formData: FormData,
): Promise<UpdateLeadResult> {
  let saved: LeadDetails;
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
    const validated = validateLeadUpdate(formData);
    if (!validated.ok) return validated;
    const expectedVersion = formData.get("expected_updated_at");
    if (!isLeadVersion(expectedVersion)) return LEAD_CONFLICT;
    const fields = validated.payload;
    const supabase = await createClient();
    const { data, error } = await supabase
      .schema("public")
      .from("leads")
      .update({
        ...fields,
        instagram: fields.instagram || null,
        email: fields.email || null,
        phone: fields.phone || null,
        service_type: fields.service_type || null,
        next_step: fields.next_step || null,
        notes: fields.notes || null,
      })
      .eq("id", leadId)
      .eq("user_id", claims.sub)
      .eq("updated_at", expectedVersion)
      .select(leadDetailColumns)
      .maybeSingle()
      .overrideTypes<LeadDetails, { merge: false }>();
    if (error) {
      if (
        (error.code === "42703" || error.code === "PGRST204") &&
        /\bnotes\b/.test(error.message)
      )
        return {
          ok: false,
          message:
            "Baza wymaga dodania pola Notatki. Zastosuj migrację etapu 4C i spróbuj ponownie.",
        };
      if (
        error.code === "23514" &&
        error.message.includes("leads_follow_up_matches_status")
      )
        return {
          ok: false,
          message:
            "Baza wymaga aktualizacji obsługi terminów. Zastosuj migrację etapu 3B i spróbuj ponownie.",
        };
      return {
        ok: false,
        message:
          "Nie udało się zapisać zmian. Dane zostały zachowane — spróbuj ponownie.",
      };
    }
    if (!data) return LEAD_CONFLICT;
    saved = data;
  } catch {
    return {
      ok: false,
      message:
        "Nie udało się zapisać zmian. Sprawdź połączenie i spróbuj ponownie.",
    };
  }
  // Błąd odświeżania po potwierdzonym zapisie nie oznacza nieudanego UPDATE.
  try {
    revalidatePath("/pipeline");
    revalidatePath("/follow-ups");
    revalidatePath("/calendar");
    return { ok: true, lead: saved, revalidated: true };
  } catch {
    /* Panel wykona router.refresh(). */
  }
  return { ok: true, lead: saved };
}

export async function deleteLead(
  leadId: string,
  expectedVersion: string,
): Promise<{ ok: true; revalidated: boolean } | { ok: false; message: string }> {
  try {
    const claims = await getAuthenticatedClaims();
    if (!claims)
      return {
        ok: false,
        message: "Sesja wygasła. Zaloguj się ponownie przed usunięciem leada.",
      };
    if (!isLeadId(leadId) || !isLeadVersion(expectedVersion))
      return { ok: false, message: "Nieprawidłowe dane leada." };

    const supabase = await createClient();
    const { data, error } = await supabase
      .schema("public")
      .from("leads")
      .delete()
      .eq("id", leadId)
      .eq("user_id", claims.sub)
      .eq("updated_at", expectedVersion)
      .in("status", ["won", "lost"])
      .select("id")
      .maybeSingle();
    if (error?.code === "42501")
      return { ok: false, message: "Nie masz uprawnień do usunięcia leada." };
    if (error) throw error;
    if (!data)
      return {
        ok: false,
        message:
          "Lead jest niedostępny, ma aktywny status lub jego dane się zmieniły. Zamknij panel i otwórz go ponownie, aby sprawdzić aktualne dane.",
      };
  } catch {
    return {
      ok: false,
      message:
        "Nie udało się potwierdzić usunięcia leada. Sprawdź połączenie i spróbuj ponownie.",
    };
  }

  let revalidated = true;
  for (const path of ["/pipeline", "/follow-ups", "/calendar"]) {
    try {
      revalidatePath(path);
    } catch {
      revalidated = false;
    }
  }
  return { ok: true, revalidated };
}
