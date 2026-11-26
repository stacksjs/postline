import { describe, expect, test } from 'bun:test'
import { zonedTimestampToUtc } from '../../app/Services/CampaignService'
import { workspace } from '../../app/Services/WorkspaceService'
import { hourInZone, isRealTimestamp, isValidTimeZone } from '../../app/Support/time'

describe('time, checked instead of guessed', () => {
  test('a zone the runtime does not know is not a zone', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone(undefined)).toBe(false)
  })

  test('a timestamp has to be a moment that exists', () => {
    expect(isRealTimestamp('2026-11-22 09:30:00')).toBe(true)
    expect(isRealTimestamp('2026-11-22 09:30')).toBe(true)
    expect(isRealTimestamp('2026-13-45 09:30:00')).toBe(false)
    expect(isRealTimestamp('2026-02-30 09:30:00')).toBe(false)
    expect(isRealTimestamp('2026-11-22 25:00:00')).toBe(false)
    expect(isRealTimestamp('2028-02-29 00:00:00')).toBe(true)
  })

  test('the hour of a moment depends on the zone it is read in', () => {
    const instant = new Date('2026-07-01T16:30:00Z')
    expect(hourInZone(instant, 'UTC')).toBe(16)
    expect(hourInZone(instant, 'Europe/Berlin')).toBe(18)
    expect(hourInZone(instant, 'America/Los_Angeles')).toBe(9)
    expect(hourInZone(new Date('2026-07-01T22:30:00Z'), 'Europe/Berlin')).toBe(0)
  })

  test('an unknown campaign zone is refused, not read as UTC', () => {
    expect(() => zonedTimestampToUtc('2026-11-22 09:00:00', 'Mars/Olympus')).toThrow('not a time zone')
    expect(zonedTimestampToUtc('2026-07-01 09:00:00', 'Europe/Berlin')).toBe('2026-07-01 07:00:00')
  })
})

describe('the workspace profile', () => {
  test('saving the time zone changes what every service reads', async () => {
    const before = await workspace.profile()
    const saved = await workspace.save({ timezone: 'Asia/Tokyo', workspaceName: 'Field Notes', name: 'Sam Rivera' })

    expect(saved).toEqual({ name: 'Sam Rivera', workspaceName: 'Field Notes', timezone: 'Asia/Tokyo', shareMediaByTunnel: false, publishingPaused: false })
    expect(await workspace.timezone()).toBe('Asia/Tokyo')

    await workspace.save(before.name.length >= 2 ? before : { ...before, name: 'Workspace owner' })
  })

  test('the temporary image link is off until the owner turns it on', async () => {
    const before = await workspace.profile()
    expect((await workspace.save({ shareMediaByTunnel: true })).shareMediaByTunnel).toBe(true)
    expect((await workspace.save({ shareMediaByTunnel: false })).shareMediaByTunnel).toBe(false)
    await workspace.save({ shareMediaByTunnel: before.shareMediaByTunnel })
  })

  test('an unknown zone and a one-letter name are refused with a reason', async () => {
    await expect(workspace.save({ timezone: 'Mars/Olympus' })).rejects.toThrow('not a time zone')
    await expect(workspace.save({ workspaceName: 'x' })).rejects.toThrow('between 2 and 120')
  })

  test('a broken zone in the database does not break scheduling', async () => {
    const { db } = await import('@stacksjs/database')
    const before = await workspace.profile()
    await (db as any).updateTable('accounts').set({ timezone: 'Not/AZone' }).execute()
    workspace.forget()

    expect(isValidTimeZone(await workspace.timezone())).toBe(true)

    await workspace.save({ timezone: before.timezone })
  })
})

describe('pausing scheduled publishing (#195)', () => {
  test('a paused workspace publishes nothing on the scheduler\'s run, and resumes', async () => {
    const { postQueue } = await import('../../app/Services/Social/QueueService')
    const { db } = await import('@stacksjs/database')
    const database = db as any
    const uuid = crypto.randomUUID()
    const due = new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' ')
    await database.insertInto('posts').values({ uuid, title: 'paused', body: 'held while paused', status: 'scheduled', scheduled_at: due, source: 'composer', timezone: 'UTC' }).execute()

    await workspace.save({ publishingPaused: true })
    expect((await workspace.profile()).publishingPaused).toBe(true)
    expect(await postQueue.publishDue()).toEqual({ published: 0, failed: 0, missed: 0 })
    const held = await database.selectFrom('posts').select(['status']).where('uuid', '=', uuid).executeTakeFirst()
    expect(held.status).toBe('scheduled')
    await database.deleteFrom('posts').where('uuid', '=', uuid).execute()
    await workspace.save({ publishingPaused: false })
    expect((await workspace.profile()).publishingPaused).toBe(false)
  })
})
