import type { ScheduleRecurrence } from "./domain.js";

// Duplicated in flue-runtime/project/workflow/work-item-workflow.ts: that package can't
// import from src (separate tsconfig, separate node_modules, Temporal's workflow bundler
// only resolves within its own package).
function safeTz(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function zonedParts(date: Date, tz: string): [number, number, number, number, number, number] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric"
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return [get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")];
}

function isWeekend(date: Date, tz: string): boolean {
  return ["Sat", "Sun"].includes(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date));
}

/** Instant whose wall clock in `tz` reads these parts. Second pass settles a DST shift. */
function fromZonedParts(naive: number, tz: string): Date {
  let guess = naive;
  for (let i = 0; i < 2; i++) {
    const [y, m, d, h, min, s] = zonedParts(new Date(guess), tz);
    guess += naive - Date.UTC(y, m, d, h, min, s);
  }
  return new Date(guess);
}

function addCalendarDay(date: Date, tz: string): Date {
  const [y, m, d, h, min, s] = zonedParts(date, tz);
  return fromZonedParts(Date.UTC(y, m, d + 1, h, min, s), tz);
}

/** First run of a new schedule. Without this a daily one inherits the minute it was created on. */
export function nextScheduleStart(
  recurrence: ScheduleRecurrence,
  timeOfDay: string,
  from: Date,
  timezone: string
): Date {
  const tz = safeTz(timezone);
  if (recurrence === "hourly") return nextScheduleRun(recurrence, from, tz);
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(timeOfDay.trim());
  if (!match) throw new Error("Enter the time as HH:MM, for example 07:00");
  const [year, month, day] = zonedParts(from, tz);
  let next = fromZonedParts(Date.UTC(year, month, day, Number(match[1]), Number(match[2]), 0), tz);
  while (next.getTime() <= from.getTime() || (recurrence === "weekdays" && isWeekend(next, tz)))
    next = addCalendarDay(next, tz);
  return next;
}

function nextScheduleRun(recurrence: ScheduleRecurrence, previous: Date, timezone: string): Date {
  const tz = safeTz(timezone);
  let next = new Date(previous);
  if (recurrence === "hourly") next.setTime(next.getTime() + 3_600_000);
  else next = addCalendarDay(next, tz);
  if (recurrence === "weekdays") {
    while (isWeekend(next, tz)) next = addCalendarDay(next, tz);
  }
  return next;
}
