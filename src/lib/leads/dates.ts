export const CRM_TIME_ZONE = "Europe/Warsaw";

export const FOLLOW_UP_QUICK_DATES = [
  { label: "Dziś", days: 0 },
  { label: "Jutro", days: 1 },
  { label: "+3 dni", days: 3 },
  { label: "+7 dni", days: 7 },
] as const;

function dateOnlyAsUTC(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

export function getTodayInWarsaw(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CRM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function millisecondsUntilNextWarsawDay(now = new Date()) {
  const target = dateOnlyAsUTC(getTodayInWarsaw(now));
  target.setUTCDate(target.getUTCDate() + 1);
  target.setUTCHours(0, 0, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CRM_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let midnight = target.getTime();
  // Przeliczamy warszawską północ na chwilę UTC według offsetu docelowego
  // dnia. Nie dodajemy 24 godzin: dzień zmiany czasu ma 23 lub 25 godzin.
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = formatter.formatToParts(new Date(midnight));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((entry) => entry.type === type)?.value);
    const localAsUTC = new Date(0);
    localAsUTC.setUTCFullYear(part("year"), part("month") - 1, part("day"));
    localAsUTC.setUTCHours(part("hour"), part("minute"), part("second"), 0);
    midnight += target.getTime() - localAsUTC.getTime();
  }
  return Math.max(1, midnight - now.getTime());
}

export function followUpQuickDate(days: number, now = new Date()) {
  // Najpierw ustalamy dzień w Warszawie. UTC jest wyłącznie nośnikiem
  // arytmetyki dat kalendarzowych, niezależnej od strefy i DST urządzenia.
  const date = dateOnlyAsUTC(getTodayInWarsaw(now));
  date.setUTCDate(date.getUTCDate() + days);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function formatFollowUpDate(value: string) {
  // DATE jest samym dniem, bez godziny i strefy: zachowujemy dokładnie ten dzień.
  const date = dateOnlyAsUTC(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function calendarMonthLabel(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(dateOnlyAsUTC(value));
}

export function calendarDayLabel(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    year >= 1 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= monthLengths[month - 1]
  );
}

export function formatLocalDate(date: Date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date;
}

export function addLocalDays(date: Date, days: number) {
  const result = parseLocalDate(formatLocalDate(date));
  result.setDate(result.getDate() + days);
  return result;
}

export function addLocalMonths(date: Date, months: number) {
  const result = parseLocalDate(formatLocalDate(date));
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
  ).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

export function calendarMonthDays(month: Date) {
  const first = parseLocalDate(formatLocalDate(month));
  first.setDate(1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = addLocalDays(first, index - offset);
    return {
      value: formatLocalDate(date),
      day: date.getDate(),
      inMonth: date.getMonth() === month.getMonth(),
    };
  });
}

export function calendarNavigation(value: string, key: string) {
  const date = parseLocalDate(value);
  const weekday = (date.getDay() + 6) % 7;
  const offsets: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
    Home: -weekday,
    End: 6 - weekday,
  };
  let next: Date;
  if (key in offsets) next = addLocalDays(date, offsets[key]);
  else if (key === "PageUp" || key === "PageDown")
    next = addLocalMonths(date, key === "PageUp" ? -1 : 1);
  else return null;
  const result = formatLocalDate(next);
  return isValidDateOnly(result) ? result : null;
}
