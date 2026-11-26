/**
 * Time zones and timestamps, checked instead of guessed.
 *
 * An unknown zone used to become UTC without a word, and a timestamp only
 * had to look like one: `2026-13-45 25:00:00` matched the pattern. Both now
 * fail with a message the owner can act on.
 *
 * No imports: the same checks are safe to use anywhere.
 */

/** Whether the runtime knows `zone` as an IANA time zone. */
export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone.trim() })
    return true
  }
  catch {
    return false
  }
}

/** The zone this machine is set to, or UTC when it cannot say. */
export function systemTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return isValidTimeZone(zone) ? zone : 'UTC'
}

/**
 * Whether `value` is a real `YYYY-MM-DD HH:MM[:SS]` moment. The pattern alone
 * is not enough: JavaScript rolls the 45th of month 13 over into a real date
 * instead of refusing it, so the parts are read back and compared.
 */
export function isRealTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) return false
  const [year, month, day, hour, minute, second] = match.slice(1).map(part => Number(part ?? 0))
  const date = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second || 0))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month! - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === (second || 0)
}

/** The hour of day (0 to 23) that `instant` falls in, in `zone`. */
export function hourInZone(instant: Date, zone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', hour: '2-digit' }).format(instant)
  return Number(hour) % 24
}

/** Format a UTC instant as a local calendar timestamp with seconds. */
export function wallTimeInZone(instant: Date, zone: string): string {
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
  const parts = Object.fromEntries(clock.formatToParts(instant).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

/** Convert a local timestamp to an instant, returning null in a clock gap. */
export function instantFromWallTime(wallTime: string, zone: string): Date | null {
  if (wallTime.length !== 19 || !isRealTimestamp(wallTime) || !isValidTimeZone(zone)) return null
  const wallClockMs = Date.parse(`${wallTime.replace(' ', 'T')}Z`)
  const date = new Date(wallClockMs)
  for (let pass = 0; pass < 3; pass++) {
    const shown = wallTimeInZone(date, zone)
    if (shown === wallTime) return date
    date.setTime(date.getTime() + wallClockMs - Date.parse(`${shown.replace(' ', 'T')}Z`))
  }
  return null
}
