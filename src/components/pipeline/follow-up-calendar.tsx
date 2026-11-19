"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  addLocalMonths,
  calendarMonthDays,
  calendarNavigation,
  calendarDayLabel,
  calendarMonthLabel,
  formatLocalDate,
  getTodayInWarsaw,
  isValidDateOnly,
  parseLocalDate,
} from "@/lib/leads/dates";

type CalendarProps = {
  value: string;
  onSelect: (value: string) => void;
  today?: string;
};
const weekdays = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];

export function FollowUpCalendar({
  value,
  onSelect,
  today = getTodayInWarsaw(),
}: CalendarProps) {
  const [month, setMonth] = useState(() => parseLocalDate(value || today));
  const [focused, setFocused] = useState(() => value || today);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const containerRef = useRef<HTMLDivElement>(null);
  const focusRequested = useRef(true);

  useEffect(() => {
    if (focusRequested.current) {
      containerRef.current?.scrollIntoView({ block: "nearest" });
      dayRefs.current.get(focused)?.focus({ preventScroll: true });
      focusRequested.current = false;
    }
  }, [focused, month]);

  function changeMonth(offset: number) {
    const next = addLocalMonths(month, offset);
    if (!isValidDateOnly(formatLocalDate(next))) return;
    next.setDate(1);
    setMonth(next);
    setFocused(formatLocalDate(next));
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const nextValue = calendarNavigation(day, event.key);
    if (!nextValue) return;
    event.preventDefault();
    focusRequested.current = true;
    setFocused(nextValue);
    setMonth(parseLocalDate(nextValue));
  }

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Kalendarz terminu follow-upu"
      className="mt-3 rounded-xl border border-zinc-200 bg-white p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Poprzedni miesiąc"
          onClick={() => changeMonth(-1)}
          disabled={month.getFullYear() === 1 && month.getMonth() === 0}
          className="size-10 rounded-lg text-lg hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-rose-900 disabled:opacity-40"
        >
          ‹
        </button>
        <h3
          aria-live="polite"
          className="text-sm font-semibold capitalize text-zinc-900"
        >
          {calendarMonthLabel(formatLocalDate(month))}
        </h3>
        <button
          type="button"
          aria-label="Następny miesiąc"
          onClick={() => changeMonth(1)}
          disabled={month.getFullYear() === 9999 && month.getMonth() === 11}
          className="size-10 rounded-lg text-lg hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-rose-900 disabled:opacity-40"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weekdays.map((label) => (
          <span key={label} className="py-1 text-center text-xs text-zinc-500">
            {label}
          </span>
        ))}
        {calendarMonthDays(month).map((day) => (
          <button
            key={day.value}
            ref={(node) => {
              if (node) dayRefs.current.set(day.value, node);
              else dayRefs.current.delete(day.value);
            }}
            type="button"
            disabled={!isValidDateOnly(day.value)}
            tabIndex={focused === day.value ? 0 : -1}
            aria-label={calendarDayLabel(day.value)}
            aria-pressed={value === day.value}
            aria-current={today === day.value ? "date" : undefined}
            onKeyDown={(event) => navigate(event, day.value)}
            onFocus={() => setFocused(day.value)}
            onClick={() => onSelect(day.value)}
            className={`min-h-10 rounded-lg text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose-900 disabled:opacity-30 ${value === day.value ? "bg-[#542b39] font-semibold text-white" : `${day.inMonth ? "text-zinc-800" : "text-zinc-400"} hover:bg-zinc-100 ${today === day.value ? "ring-1 ring-inset ring-[#734353]" : ""}`}`}
          >
            {day.day}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        Strzałki zmieniają dzień, Page Up/Down — miesiąc. Enter wybiera datę.
      </p>
    </div>
  );
}
