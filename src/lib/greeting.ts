/** "Good morning" by clock hour; the small hours before the planner day starts are "Still up". */
export function greetingFor(hour: number, dayStartHour: number): string {
  if (hour < dayStartHour) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** A kind, specific line about today's progress (never a scolding one). */
export function momentumLine(done: number, open: number): string {
  if (done === 0) return open > 0 ? 'Start with the smallest thing. Momentum does the rest.' : 'A fresh page. Add one thing that matters.'
  if (open === 0) return `${done} done and nothing left. That's a full day.`
  if (done === 1) return '1 done already. Nice start.'
  return `${done} done today. Keep the streak rolling.`
}
