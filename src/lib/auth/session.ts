import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedClaims() {
  const supabase = await createClient();

  try {
    const { data, error } = await supabase.auth.getClaims();
    return !error && data?.claims.sub && !data.claims.is_anonymous
      ? data.claims
      : null;
  } catch {
    // Błąd weryfikacji lub komunikacji nigdy nie otwiera dostępu do CRM.
    return null;
  }
}
