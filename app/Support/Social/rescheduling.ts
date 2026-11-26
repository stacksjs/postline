import { UserFacingError } from '../Http/user-error'
import { instantFromWallTime, isRealTimestamp, wallTimeInZone } from '../time'

export interface ScheduledSelection {
  id: number
  scheduledAt: string
}

export type ScheduleDestination = { days: number } | { date: string }

export const MAX_QUEUE_SELECTION = 50

/** Move a scheduled instant by calendar day while keeping its workspace clock time. */
export function moveScheduledTime(previous: string, destination: ScheduleDestination, zone: string): string {
  const instantOf = (timestamp: string): Date => new Date(`${timestamp.replace(' ', 'T')}Z`)
  const current = wallTimeInZone(instantOf(previous), zone)
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
  const next = instantFromWallTime(wanted, zone)
  if (!next) throw new UserFacingError('A post’s scheduled time does not exist on the new date in your workspace time zone.')
  return next.toISOString().slice(0, 19).replace('T', ' ')
}
