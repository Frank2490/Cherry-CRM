"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSafeRedirect } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState = {
  message?: string;
  email?: string;
  fieldErrors?: { email?: string; password?: string };
};

export async function login(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");
  const email = typeof emailValue === "string" ? emailValue.trim() : "";
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const fieldErrors: NonNullable<AuthActionState["fieldErrors"]> = {};

  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fieldErrors.email = "Wpisz poprawny adres e-mail.";
  }
  if (!password) fieldErrors.password = "Wpisz hasło.";
  if (Object.keys(fieldErrors).length) return { email, fieldErrors };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      let message = "Nieprawidłowy adres e-mail lub hasło.";
      if (error?.code === "email_not_confirmed") {
        message = "Potwierdź adres e-mail przed zalogowaniem.";
      } else if (error?.status === 429) {
        message = "Zbyt wiele prób logowania. Odczekaj chwilę i spróbuj ponownie.";
      } else if (error?.status === 0 || (error?.status && error.status >= 500)) {
        message = "Usługa logowania jest chwilowo niedostępna. Spróbuj ponownie.";
      }
      return { email, message };
    }
  } catch {
    return { email, message: "Nie udało się połączyć z usługą logowania. Spróbuj ponownie." };
  }

  revalidatePath("/", "layout");
  redirect(getSafeRedirect(formData.get("next")));
}

export async function logout(): Promise<AuthActionState> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) return { message: "Nie udało się wylogować. Spróbuj ponownie." };
  } catch {
    return { message: "Nie udało się wylogować. Sprawdź połączenie i spróbuj ponownie." };
  }

  revalidatePath("/", "layout");
  redirect("/login");
}
