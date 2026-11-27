import type { SocialProvider } from './types'
import { instantFromWallTime, wallTimeInZone } from '../time'

export interface PostingSlot {
  provider: SocialProvider
  /** Sunday is zero, as in JavaScript's Date. */
  weekday: number
  minute: number
}

export function slotTime(minute: number): string {
  return [Math.floor(minute / 60), minute % 60].map(part => String(part).padStart(2, '0')).join(':')
}

export function nextPostingSlot(slots: readonly PostingSlot[], timezone: string, from: Date, occupied: ReadonlySet<string>): string | null {
  const ordered = slots.filter(slot => Number.isInteger(slot.weekday) && slot.weekday >= 0 && slot.weekday <= 6
    && Number.isInteger(slot.minute) && slot.minute >= 0 && slot.minute < 1440)
    .sort((left, right) => left.minute - right.minute)
  if (!ordered.length) return null
  const firstDay = wallTimeInZone(from, timezone).slice(0, 10)
  // Walk calendar dates as UTC so advancing a day cannot skip a local date
  // when an offset changes. Resolve each matching wall time separately.
  const day = new Date(`${firstDay}T00:00:00Z`)
  for (;;) {
    const date = day.toISOString().slice(0, 10)
    for (const slot of ordered) {
      if (slot.weekday !== day.getUTCDay()) continue
      const instant = instantFromWallTime(`${date} ${slotTime(slot.minute)}:00`, timezone)
      if (!instant || instant <= from) continue
      const at = instant.toISOString().slice(0, 19).replace('T', ' ')
      if (!occupied.has(at.slice(0, 16))) return at
    }
    day.setUTCDate(day.getUTCDate() + 1)
  }
}
