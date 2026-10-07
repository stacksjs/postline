import { describe, expect, test } from 'bun:test'
import { DEFAULT_RETENTION_PROVIDERS, normalizeDays, resolveRetentionSave, settingsFromRow } from '../../app/Services/RetentionService'
import { cutoffFor, isOlderThan, parseTimestamp, postPurge } from '../../app/Services/Social/PurgeService'

/**
 * Automatic deletion ("delete posts older than N days"). What has to hold is
 * that only posts provably past the cutoff ever match, and that a schedule can
 * neither run without consent nor turn into a full wipe.
 */

describe('age cutoff', () => {
  const now = new Date('2026-10-10T12:00:00Z')

  test('reads both provider ISO times and SQLite UTC timestamps', () => {
    expect(parseTimestamp('2026-10-01T08:30:00.000Z')?.toISOString()).toBe('2026-10-01T08:30:00.000Z')
    // `now()` in support.ts writes UTC without a zone; it must not be read as local time.
    expect(parseTimestamp('2026-10-01 08:30:00')?.toISOString()).toBe('2026-10-01T08:30:00.000Z')
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('not a date')).toBeNull()
    expect(parseTimestamp(undefined)).toBeNull()
  })

  test('the cutoff is exactly N days back', () => {
    expect(cutoffFor(7, now)?.toISOString()).toBe('2026-10-03T12:00:00.000Z')
    expect(cutoffFor(undefined, now)).toBeNull()
  })

  test('rejects an age limit under a day', () => {
    expect(() => cutoffFor(0, now)).toThrow(/at least one day/)
    expect(() => cutoffFor(-3, now)).toThrow(/at least one day/)
    expect(() => cutoffFor(Number.NaN, now)).toThrow(/at least one day/)
  })

  test('only posts dated before the cutoff match; undated posts are kept', () => {
    const cutoff = cutoffFor(7, now)!
    expect(isOlderThan('2026-09-30T00:00:00Z', cutoff)).toBe(true)
    expect(isOlderThan('2026-10-03 11:59:59', cutoff)).toBe(true)
    expect(isOlderThan('2026-10-03 12:00:00', cutoff)).toBe(false)
    expect(isOlderThan('2026-10-09T00:00:00Z', cutoff)).toBe(false)
    expect(isOlderThan(undefined, cutoff)).toBe(false)
    expect(isOlderThan('garbage', cutoff)).toBe(false)
  })
})

describe('retention settings', () => {
  test('days are whole and within bounds', () => {
    expect(normalizeDays(7)).toBe(7)
    expect(normalizeDays('30')).toBe(30)
    expect(normalizeDays(7.9)).toBe(7)
    expect(() => normalizeDays(0)).toThrow()
    expect(() => normalizeDays(3651)).toThrow()
    expect(() => normalizeDays('soon')).toThrow()
  })

  test('a missing or malformed row reads as off', () => {
    expect(settingsFromRow(undefined)).toEqual({ enabled: false, days: 7, providers: [], scope: 'all' })
    expect(settingsFromRow({ auto_delete_enabled: 1, auto_delete_days: -4, auto_delete_providers: '{', auto_delete_scope: 'nope' }))
      .toEqual({ enabled: true, days: 7, providers: [], scope: 'all' })
  })

  test('stored providers are filtered to networks that can delete', () => {
    const settings = settingsFromRow({
      auto_delete_enabled: 0,
      auto_delete_days: 14,
      auto_delete_providers: JSON.stringify(['bluesky', 'instagram', 'twitter']),
      auto_delete_scope: 'tracked',
    })
    expect(settings).toEqual({ enabled: false, days: 14, providers: ['bluesky', 'twitter'], scope: 'tracked' })
  })

  test('by default a schedule touches the social networks, never the publication', () => {
    expect(DEFAULT_RETENTION_PROVIDERS).not.toContain('opentimes')
    expect(DEFAULT_RETENTION_PROVIDERS).toEqual(['bluesky', 'twitter', 'mastodon', 'linkedin'])
  })
})

describe('scheduled deletion safeguards', () => {
  test('refuses to run without an age limit', async () => {
    await expect(postPurge.purgeOlderThan({ olderThanDays: 0 })).rejects.toThrow(/age limit/)
    await expect(postPurge.purgeOlderThan({ olderThanDays: Number.NaN })).rejects.toThrow(/age limit/)
  })

  const off = settingsFromRow(undefined)
  const on = { ...off, enabled: true }

  test('switching it on needs an explicit acknowledgement', () => {
    expect(() => resolveRetentionSave({ enabled: true, days: 7 }, off)).toThrow(/permanently deleted/)
    expect(resolveRetentionSave({ enabled: true, days: 7, acknowledged: true }, off).enabled).toBe(true)
  })

  test('once on, later edits and switching off need no acknowledgement', () => {
    expect(resolveRetentionSave({ days: 30 }, on)).toEqual({ ...on, days: 30 })
    expect(resolveRetentionSave({ enabled: false }, on).enabled).toBe(false)
  })

  test('rejects networks that cannot delete, and bad day counts', () => {
    expect(() => resolveRetentionSave({ providers: ['instagram'] }, off)).toThrow(/cannot delete/)
    expect(() => resolveRetentionSave({ days: 0 }, off)).toThrow(/between/)
  })

  test('an age-limited preview reports its cutoff and deletes nothing', async () => {
    const result = await postPurge.preview({ providers: ['threads'], scope: 'all', olderThanDays: 7 })
    expect(result.dryRun).toBe(true)
    expect(result.olderThanDays).toBe(7)
    expect(result.cutoff).not.toBeNull()
    expect(result.deleted).toBe(0)
  })
})
