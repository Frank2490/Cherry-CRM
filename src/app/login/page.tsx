import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { SectionIcon } from "@/components/section-icon";
import { getSafeRedirect } from "@/lib/auth/redirect";
import { getAuthenticatedClaims } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Logowanie" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const next = getSafeRedirect((await searchParams).next);
  if (await getAuthenticatedClaims()) redirect(next);

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-[#542b39] text-white">
            <SectionIcon name="pipeline" className="size-6" />
          </span>
          <span className="text-2xl font-semibold tracking-tight text-zinc-950">CRM</span>
        </div>

        <section aria-labelledby="login-title" className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs sm:p-8">
          <h1 id="login-title" className="text-2xl font-semibold tracking-tight text-zinc-950">
            Zaloguj się
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            Wróć do rozmów i kolejnych możliwości.
          </p>
          <LoginForm next={next} />
        </section>
      </div>
    </main>
  );
}
