import type { Metadata } from "next";
import { FollowUpCalendarView } from "@/components/calendar/follow-up-calendar-view";
import { getFollowUpLeads } from "@/lib/leads/follow-up-queries";
import { getCalendarDays, getCalendarRange } from "@/lib/leads/calendar";
import { getTodayInWarsaw, isValidDateOnly } from "@/lib/leads/dates";

export const metadata: Metadata = { title: "Kalendarz" };

export default async function CalendarPage({ searchParams }: {
  searchParams: Promise<{ date?: string | string[]; view?: string | string[] }>;
}) {
  const params = await searchParams;
  const today = getTodayInWarsaw();
  const anchor = typeof params.date === "string" && isValidDateOnly(params.date) ? params.date : today;
  const view = params.view === "week" ? "week" : "month";
  const days = getCalendarDays(anchor, view);
  const result = await getFollowUpLeads("/calendar", getCalendarRange(days));
  return (
    <div className="min-w-0">
      <header className="mb-8 sm:mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-[34px]">
          Kalendarz
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-600 sm:text-base">
          Zaplanowane kontakty z klientami w jednym miejscu.
        </p>
      </header>
      <FollowUpCalendarView
        result={result}
        initialToday={today}
        anchor={anchor}
        view={view}
        days={days}
      />
    </div>
  );
}
