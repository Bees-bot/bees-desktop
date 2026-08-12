import type { ScheduleRecurrence } from "./domain.js";

const MINUTE = 60_000;

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

function addCalendarDay(date: Date, tz: string): Date {
  const [y, m, d, h, min, s] = zonedParts(date, tz);
  const naive = Date.UTC(y, m, d + 1, h, min, s);
  let guess = naive;
  for (let i = 0; i < 2; i++) {
    const [gy, gm, gd, gh, gmin, gs] = zonedParts(new Date(guess), tz);
    guess += naive - Date.UTC(gy, gm, gd, gh, gmin, gs);
  }
  return new Date(guess);
}

export function nextScheduleRun(recurrence: ScheduleRecurrence, previous: Date, timezone: string): Date {
  const tz = safeTz(timezone);
  let next = new Date(previous);
  if (recurrence === "hourly") next.setTime(next.getTime() + 60 * MINUTE);
  else next = addCalendarDay(next, tz);
  if (recurrence === "weekdays") {
    while (isWeekend(next, tz)) next = addCalendarDay(next, tz);
  }
  return next;
}
