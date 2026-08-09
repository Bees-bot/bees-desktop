import type { ScheduleRecurrence } from "./domain.js";

const MINUTE = 60_000;

export function nextScheduleRun(recurrence: ScheduleRecurrence, previous: Date): Date {
  const next = new Date(previous);
  if (recurrence === "hourly") next.setTime(next.getTime() + 60 * MINUTE);
  else next.setTime(next.getTime() + 24 * 60 * MINUTE);
  if (recurrence === "weekdays") {
    while ([0, 6].includes(next.getDay())) next.setTime(next.getTime() + 24 * 60 * MINUTE);
  }
  // The selected first occurrence is local-time aware; Temporal durably advances later occurrences.
  return next;
}
