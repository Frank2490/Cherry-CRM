import type { Metadata } from "next";
import { UnsavedChangesGuard } from "@/components/unsaved-changes-guard";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: {
    default: "Cherry CRM",
    template: "%s | Cherry CRM",
  },
  description: "Prywatny CRM do obsługi leadów sprzedażowych.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body>
        <UnsavedChangesGuard />
        {children}
      </body>
    </html>
  );
}
