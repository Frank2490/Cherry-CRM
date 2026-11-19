export function getSupabaseEnv() {
  // Bezpośrednie odwołania pozwalają Next.js udostępnić te wartości w przeglądarce.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !publishableKey && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ].filter(Boolean);

  if (!url || !publishableKey) {
    throw new Error(
      `Brak konfiguracji Supabase: ${missing.join(", ")}. Uzupełnij .env.local i uruchom aplikację ponownie.`,
    );
  }

  try {
    if (!["http:", "https:"].includes(new URL(url).protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error(
      "Niepoprawny NEXT_PUBLIC_SUPABASE_URL. Wklej Project URL (adres HTTP lub HTTPS) do .env.local.",
    );
  }

  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error(
      "Niepoprawny NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Wklej Publishable Key zaczynający się od sb_publishable_ do .env.local.",
    );
  }

  return { url, publishableKey };
}
