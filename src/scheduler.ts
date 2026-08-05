import type { Schedule, ScheduleRecurrence } from "./domain.js";

const MINUTE = 60_000;

export function nextScheduleRun(recurrence: ScheduleRecurrence, previous: Date): Date {
  const next = new Date(previous);
  if (recurrence === "hourly") next.setTime(next.getTime() + 60 * MINUTE);
  else next.setTime(next.getTime() + 24 * 60 * MINUTE);
  if (recurrence === "weekdays") {
    while ([0, 6].includes(next.getDay())) next.setTime(next.getTime() + 24 * 60 * MINUTE);
  }
  // ponytail: fixed elapsed days keep v1 small; replace with Temporal when DST wall-clock fidelity matters.
  return next;
}

export interface ScheduleStore {
  listSchedules(teamId: string): Promise<Schedule[]>;
  updateScheduleAfterTick(id: string, nextRunAt: string, ran: boolean): Promise<void>;
}

export class AppOpenScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly store: ScheduleStore,
    private readonly teamId: () => string,
    private readonly run: (schedule: Schedule) => Promise<void>,
    private readonly intervalMs = 30_000,
    private readonly graceMs = 90_000
  ) {}

  async start(): Promise<void> {
    if (this.timer) return;
    await this.tick(true);
    this.timer = setInterval(() => void this.tick(true), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(allowRun: boolean, at = new Date()): Promise<void> {
    if (this.ticking || !this.teamId()) return;
    this.ticking = true;
    try {
      const schedules = await this.store.listSchedules(this.teamId());
      for (const schedule of schedules.filter(({ enabled }) => enabled)) {
        const due = new Date(schedule.nextRunAt);
        if (due > at) continue;
        const shouldRun =
          allowRun &&
          (schedule.mode === "spawn_goal" || at.getTime() - due.getTime() <= this.graceMs);
        if (shouldRun) {
          // A failed attempt still consumes this occurrence; v1 never backfills.
          try {
            await this.run(schedule);
          } catch {
            // The caller surfaces the failure; the scheduler only advances the clock.
          }
        }
        let next = nextScheduleRun(schedule.recurrence, due);
        while (next <= at) next = nextScheduleRun(schedule.recurrence, next);
        await this.store.updateScheduleAfterTick(schedule.id, next.toISOString(), shouldRun);
      }
    } finally {
      this.ticking = false;
    }
  }
}
