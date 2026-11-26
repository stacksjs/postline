/**
 * Old local copies are trimmed, recent ones and unread alerts kept (#116).
 */
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { daysAgo, housekeeping, KEEP_DAYS, VACUUM_EVERY_DAYS, VACUUM_JOB } from '../../app/Services/HousekeepingService'

const database = db as any

describe('housekeeping', () => {
  test('removes what is past its keeping time and nothing newer', async () => {
    const old = daysAgo(KEEP_DAYS.timelineItems + 1)
    const fresh = daysAgo(1)
    const marker = crypto.randomUUID()
    for (const at of [old, fresh]) {
      await database.insertInto('timeline_items').values({ uuid: crypto.randomUUID(), provider: 'bluesky', remote_uri: `at://${marker}/${at}`, author_handle: 'a', body: marker, posted_at: at, created_at: at }).execute()
    }
    await database.insertInto('alerts').values({ kind: 'post-failed', dedupe_key: `read-${marker}`, title: `read ${marker}`, read_at: daysAgo(KEEP_DAYS.readAlerts + 1), created_at: daysAgo(KEEP_DAYS.readAlerts + 2) }).execute()
    await database.insertInto('alerts').values({ kind: 'post-failed', dedupe_key: `unread-${marker}`, title: `unread ${marker}`, read_at: null, created_at: daysAgo(400) }).execute()

    const removed = await housekeeping.prune()

    expect(removed.timelineItems).toBeGreaterThanOrEqual(1)
    const left = await database.selectFrom('timeline_items').select(['created_at']).where('body', '=', marker).execute()
    expect(left.map((row: { created_at: string }) => row.created_at)).toEqual([fresh])
    const alerts = await database.selectFrom('alerts').select(['title']).where('title', 'like', `%${marker}`).execute()
    expect(alerts.map((row: { title: string }) => row.title)).toEqual([`unread ${marker}`])
  })

  test('the stamp it compares against is the format the tables store', () => {
    expect(daysAgo(1, Date.UTC(2026, 10, 25, 12, 0, 0))).toBe('2026-11-24 12:00:00')
  })
})

describe('compacting the database (#215)', () => {
  test('runs when it never has, then not again for a month', async () => {
    await (db as any).deleteFrom('job_heartbeats').where('job', '=', VACUUM_JOB).execute()

    expect(await housekeeping.vacuumIfDue()).toBe('vacuumed')
    expect(await housekeeping.vacuumIfDue()).toBe('not-due')
    expect(await housekeeping.vacuumIfDue(Date.now() + (VACUUM_EVERY_DAYS + 1) * 24 * 60 * 60 * 1000)).toBe('vacuumed')
  })
})
