import {
  addLocalDays,
  addLocalMonths,
  calendarMonthDays,
  formatLocalDate,
  isValidDateOnly,
  parseLocalDate,
} from "@/lib/leads/dates";
import type { FollowUpLead } from "@/lib/leads/follow-ups";
import { isClosedLeadStatus } from "@/lib/leads/statuses";
export { calendarMonthLabel, calendarDayLabel } from "@/lib/leads/dates";

export type CalendarView = "month" | "week";
export type CalendarRange = { from: string; to: string };

export function groupCalendarLeads(leads: FollowUpLead[]) {
  const byDate = new Map<string, FollowUpLead[]>();
  for (const lead of leads) {
    if (
      isClosedLeadStatus(lead.status) ||
      !lead.follow_up_date ||
      !isValidDateOnly(lead.follow_up_date)
    )
      continue;
    const entries = byDate.get(lead.follow_up_date) ?? [];
    entries.push(lead);
    byDate.set(lead.follow_up_date, entries);
  }
  for (const entries of byDate.values())
    entries.sort((a, b) => a.id.localeCompare(b.id));
  return byDate;
}

export function getCalendarDays(anchor: string, view: CalendarView) {
  const date = parseLocalDate(anchor);
  if (view === "week") {
    const monday = addLocalDays(date, -((date.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, offset) => {
      const day = addLocalDays(monday, offset);
      return { value: formatLocalDate(day), day: day.getDate(), inMonth: true };
    });
  }
  const days = calendarMonthDays(date);
  const lastCurrentDay = days.reduce(
    (last, day, index) => (day.inMonth ? index : last),
    0,
  );
  return days.slice(0, Math.ceil((lastCurrentDay + 1) / 7) * 7);
}

export function getCalendarRange(days: ReturnType<typeof getCalendarDays>): CalendarRange {
  const visible = days.filter((day) => isValidDateOnly(day.value));
  return { from: visible[0].value, to: visible[visible.length - 1].value };
}

export function moveCalendarAnchor(
  anchor: string,
  view: CalendarView,
  direction: number,
) {
  const date = parseLocalDate(anchor);
  // Miesiące przechodzimy od pierwszego dnia, bez przepełnienia np. 31 stycznia.
  if (view === "month") date.setDate(1);
  const next = formatLocalDate(
    view === "month"
      ? addLocalMonths(date, direction)
      : addLocalDays(date, direction * 7),
  );
  return isValidDateOnly(next) ? next : null;
}

