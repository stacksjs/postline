import { instantFromWallTime, wallTimeInZone } from '../time'

export const RECURRENCE_INTERVALS = ['daily', 'weekly', 'monthly'] as const
export type RecurrenceInterval = typeof RECURRENCE_INTERVALS[number]

export interface RecurringSegment {
  title: string
  body: string
  content: string | null
}

interface Recurrence {
  startsAt: string
  timezone: string
  interval: RecurrenceInterval
}

const dayMs = 86_400_000

function utcDate(timestamp: string): Date {
  return new Date(timestamp.replace(' ', 'T') + 'Z')
}

function timestamp(instant: Date): string {
  return instant.toISOString().slice(0, 19).replace('T', ' ')
}

/** Return the first occurrence strictly after the supplied UTC time. */
export function nextRecurringAt({ startsAt, timezone, interval }: Recurrence, after: string): string {
  if (startsAt > after) return startsAt

  const anchor = utcDate(wallTimeInZone(utcDate(startsAt), timezone))
  const end = utcDate(wallTimeInZone(utcDate(after), timezone))
  const stride = interval === 'weekly' ? 7 : 1
  const month = (date: Date) => date.getUTCFullYear() * 12 + date.getUTCMonth()
  const clock = timestamp(anchor).slice(11)
  const start = Math.max(1, interval === 'monthly'
    ? month(end) - month(anchor)
    : Math.floor((end.getTime() - anchor.getTime()) / (dayMs * stride)))

  for (let index = start; ; index++) {
    const date = new Date(anchor)
    if (interval === 'monthly') {
      date.setUTCDate(1)
      date.setUTCMonth(anchor.getUTCMonth() + index)
      const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
      date.setUTCDate(Math.min(anchor.getUTCDate(), last))
    }
    else {
      date.setUTCDate(anchor.getUTCDate() + index * stride)
    }
    // A nonexistent local clock time is skipped. A repeated hour uses the
    // same single instant each time the recurrence is calculated.
    const instant = instantFromWallTime(`${timestamp(date).slice(0, 10)} ${clock}`, timezone)
    if (instant) {
      const next = timestamp(instant)
      if (next > after) return next
    }
  }
}
