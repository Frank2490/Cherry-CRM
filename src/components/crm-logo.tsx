"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { confirmNavigation } from "@/lib/navigation/unsaved-changes";

export function CrmLogo() {
  const pathname = usePathname();

  return (
    <Link
      href="/pipeline"
      aria-label="Cherry CRM — Pipeline"
      onNavigate={(event) => {
        if (pathname !== "/pipeline" && !confirmNavigation()) event.preventDefault();
      }}
      className="inline-flex h-8 w-24 max-w-full flex-none items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-900 lg:h-10 lg:w-30"
    >
      <Image
        src="/cherry-crm-logo.png"
        alt="Cherry CRM"
        width={120}
        height={40}
        preload
        className="h-full max-h-full w-auto max-w-full object-contain"
      />
    </Link>
  );
}
