"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SectionIcon } from "@/components/section-icon";
import { confirmNavigation } from "@/lib/navigation/unsaved-changes";

const navigation = [
  { href: "/pipeline", label: "Pipeline", icon: "pipeline" },
  { href: "/follow-ups", label: "Follow-upy", icon: "follow-ups" },
  { href: "/calendar", label: "Kalendarz", icon: "calendar" },
] as const;

export function AppNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Nawigacja główna"
      className="grid w-full grid-cols-3 gap-1 rounded-xl border border-zinc-200 bg-zinc-100/70 p-1 sm:flex sm:w-auto"
    >
      {navigation.map(({ href, label, icon }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            onNavigate={(event) => {
              if (pathname !== href && !confirmNavigation()) event.preventDefault();
            }}
            aria-current={isActive ? "page" : undefined}
            className={`flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 motion-reduce:transition-none sm:px-4 sm:text-sm ${
              isActive
                ? "bg-[#542b39] text-white shadow-sm"
                : "text-zinc-600 hover:bg-white hover:text-zinc-950"
            }`}
          >
            <SectionIcon name={icon} className="hidden size-4 shrink-0 sm:block" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
