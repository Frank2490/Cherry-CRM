import { redirect } from "next/navigation";
import { AppNavigation } from "@/components/app-navigation";
import { CrmLogo } from "@/components/crm-logo";
import { LogoutButton } from "@/components/logout-button";
import { getAuthenticatedClaims } from "@/lib/auth/session";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  if (!(await getAuthenticatedClaims())) redirect("/login");

  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-10 rounded-lg bg-[#542b39] px-4 py-3 text-sm font-medium text-white focus:not-sr-only focus:outline-2 focus:outline-offset-2 focus:outline-rose-900"
      >
        Przejdź do treści
      </a>

      <header className="border-b border-zinc-200 bg-white lg:h-[76px]">
        <div className="mx-auto grid h-full min-w-0 max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-2 sm:px-8 lg:flex lg:gap-6 lg:px-10 lg:py-0">
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            <CrmLogo />
            <span className="ml-2 hidden border-l border-zinc-200 pl-4 text-xs text-zinc-500 xl:block">
              Twoja przestrzeń pracy
            </span>
          </div>

          <div className="order-3 col-span-2 min-w-0 lg:order-2 lg:ml-auto">
            <AppNavigation />
          </div>
          <div className="order-2 lg:order-3">
            <LogoutButton />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-7xl px-5 py-9 outline-none sm:px-8 sm:py-12 lg:px-10 lg:py-14"
      >
        {children}
      </main>
    </div>
  );
}
