export function scheduleDraft(schedule) {
  const [minute, hour, dayOfMonth, , dayOfWeek] = (schedule?.expression ?? '0 9 * * *').split(/\s+/);
  return { frequency: 'daily', hour: Number(hour) || 0, minute: Number(minute) || 0,
    dayOfWeek: /^\d$/.test(dayOfWeek) ? Number(dayOfWeek) : 1,
    dayOfMonth: /^\d+$/.test(dayOfMonth) ? Number(dayOfMonth) : 1,
    everyMinutes: 60, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, prompt: '',
    ...schedule, cronExpression: schedule?.expression ?? '0 9 * * *' };
}
