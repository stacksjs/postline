import { UserFacingError } from '../Http/user-error'
import { isRealTimestamp } from '../time'

export interface ScheduledSelection {
  id: number
  scheduledAt: string
}

export type ScheduleDestination = { days: number } | { date: string }

export const MAX_QUEUE_SELECTION = 50

/** Move a scheduled instant by calendar day while keeping its workspace clock time. */
export function moveScheduledTime(previous: string, destination: ScheduleDestination, zone: string): string {
  const clock = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const readClock = (instant: Date): string => {
    const parts = Object.fromEntries(clock.formatToParts(instant).map(part => [part.type, part.value]))
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
  }
  const instantOf = (timestamp: string): Date => new Date(`${timestamp.replace(' ', 'T')}Z`)
  const current = readClock(instantOf(previous))
  const date = instantOf(current)
  if ('date' in destination) {
    if (current.startsWith(destination.date)) return previous
    const [year, month, day] = destination.date.split('-').map(Number)
    date.setUTCFullYear(year!, month! - 1, day)
  }
  else {
    date.setUTCDate(date.getUTCDate() + destination.days)
  }
  const wanted = date.toISOString().slice(0, 19).replace('T', ' ')
  if (!isRealTimestamp(wanted)) throw new UserFacingError('Pick a valid calendar date.')
  const wallClockMs = date.getTime()

  // Find the instant whose local clock reads the requested time. The second
  // offset calculation covers DST between the UTC guess and the local time.
  for (let pass = 0; pass < 3; pass++) {
    const shown = readClock(date)
    if (shown === wanted) return date.toISOString().slice(0, 19).replace('T', ' ')
    date.setTime(date.getTime() + wallClockMs - instantOf(shown).getTime())
  }
  throw new UserFacingError('A post’s scheduled time does not exist on the new date in your workspace time zone.')
}
