/**
 * An export from one install imports cleanly into another (#209).
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '@stacksjs/database'
import { composerPresets } from '../../app/Services/ComposerPresetService'
import { draftFeeds } from '../../app/Services/DraftFeedService'
import { changePostingSlot, listPostingSlots } from '../../app/Services/PostingSlotService'
import { keywordMonitoring } from '../../app/Services/KeywordMonitoringService'
import { recurringPosts } from '../../app/Services/RecurringPostService'
import { postQueue } from '../../app/Services/Social/QueueService'
import { ensureAccount } from '../../app/Services/Social/support'
import { rememberTwitterBrowserHandle, twitterBrowserSession } from '../../app/Services/Social/TwitterBrowserSession'
import { trackedLinks } from '../../app/Services/TrackedLinkService'
import { DELETE_EVERYTHING_PHRASE, workspaceArchive } from '../../app/Services/WorkspaceArchiveService'
import { wallTimeInZone } from '../../app/Support/time'
import { workspace } from '../../app/Services/WorkspaceService'
import { MEDIA_DIR } from '../../app/Support/Social/uploads'

const database = db as any
const at = '2026-11-20 10:00:00'
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='

describe('workspace archive', () => {
  test('the media folder in tests is not the project\'s', () => {
    expect(MEDIA_DIR).not.toContain(process.cwd())
  })

  test('export, delete everything, import: the same workspace comes back, links intact', async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    await database.insertInto('social_identities').values({ uuid: crypto.randomUUID(), provider: 'bluesky', handle: `${tag}.bsky.social`, auth_status: 'connected', created_at: at }).execute()
    const identity = await database.selectFrom('social_identities').select(['id']).where('handle', '=', `${tag}.bsky.social`).executeTakeFirstOrThrow()
    await Bun.write(join(MEDIA_DIR, `${tag}.png`), Buffer.from(png, 'base64'))
    const postUuid = crypto.randomUUID()
    await database.insertInto('posts').values({ uuid: postUuid, title: tag, body: `post ${tag}`, status: 'published', content: JSON.stringify({ media: [{ path: `${tag}.png`, mimeType: 'image/png' }] }), published_at: at, created_at: at }).execute()
    const post = await database.selectFrom('posts').select(['id']).where('uuid', '=', postUuid).executeTakeFirstOrThrow()
    await database.insertInto('post_targets').values({ uuid: crypto.randomUUID(), provider: 'bluesky', status: 'published', remote_uri: `at://${tag}`, post_id: post.id, social_identity_id: identity.id, created_at: at }).execute()
    const campaignUuid = crypto.randomUUID()
    await database.insertInto('launch_campaigns').values({ uuid: campaignUuid, name: `Campaign ${tag}`, tone: 'clear', status: 'draft', start_date: '2026-12-01', end_date: '2026-12-10', created_at: at }).execute()
    const campaign = await database.selectFrom('launch_campaigns').select(['id']).where('uuid', '=', campaignUuid).executeTakeFirstOrThrow()
    await database.insertInto('campaign_posts').values({ uuid: crypto.randomUUID(), title: 'cp', body: 'campaign post', providers: '["bluesky"]', pillar: 'story', status: 'idea', scheduled_at: '2026-12-02 09:00:00', position: 0, launch_campaign_id: campaign.id, post_id: post.id, created_at: at }).execute()

    const watch = await keywordMonitoring.save(0, {
      name: `Browser watch ${tag}`, keywords: ['Postline'], providers: ['twitter'], twitterReadSource: 'browser',
    })
    const preset = await composerPresets.save(undefined, { kind: 'snippet', name: `Sign-off ${tag}`, body: 'Thanks for reading.' })
    const link = { code: crypto.randomUUID().replaceAll('-', '').slice(0, 16), name: `Launch ${tag}`, destination: 'https://example.org/launch', visits: 17, disabled: true }
    const accountId = await ensureAccount()
    await trackedLinks.restore(accountId, link)
    const feed = { uuid: crypto.randomUUID(), name: 'Draft feed', url: `https://example.org/${tag}.atom`, active: false, initialized: true, seen: ['a'.repeat(64)] }
    await draftFeeds.restore(accountId, feed)
    const slot = { provider: 'blog', weekday: 5, minute: 540 } as const
    await changePostingSlot(slot, false)
    const draft = await postQueue.save({ text: `Repeat ${tag}`, providers: ['blog'] })
    const startsAt = wallTimeInZone(new Date(Date.now() + 86_400_000), await workspace.timezone()).replace(' ', 'T')
    const repeat = await recurringPosts.create({ id: draft.postId, interval: 'monthly', startAt: startsAt })
    await recurringPosts.change(repeat.uuid, 'pause')
    const archive = await workspaceArchive.export()
    expect(archive.version).toBe(8)
    expect(archive.recurringPosts).toContainEqual(expect.objectContaining({ uuid: repeat.uuid, active: false, nextAt: repeat.nextAt }))
    expect(archive.postingSlots).toContainEqual(slot)
    expect(archive.composerPresets).toContainEqual(preset)
    expect(archive.trackedLinks).toContainEqual(link)
    expect(archive.draftFeeds).toContainEqual(feed)
    const archivedWatch = archive.monitors.find(row => row.name === watch.name)
    expect(archivedWatch?.twitter_read_source).toBe('browser')
    expect(archive.posts.some(row => row.uuid === postUuid)).toBe(true)
    expect(archive.media[`${tag}.png`]).toBe(png)
    expect(JSON.stringify(archive)).not.toContain('access_token')

    await rememberTwitterBrowserHandle('archive_fixture')
    const browserSession = await twitterBrowserSession()
    await expect(workspaceArchive.deleteEverything('delete everything')).rejects.toThrow(DELETE_EVERYTHING_PHRASE)
    expect(await twitterBrowserSession()).toEqual(browserSession)
    await workspaceArchive.deleteEverything(DELETE_EVERYTHING_PHRASE)
    expect(await ensureAccount()).toBe(accountId)
    expect(await twitterBrowserSession()).toEqual({ profile: browserSession.profile, handle: null, needsCheck: false })
    expect(await composerPresets.list()).toEqual([])
    expect(await trackedLinks.export(accountId)).toEqual([])
    expect(await draftFeeds.list()).toEqual([])
    expect(await listPostingSlots(accountId)).toEqual([])
    expect((await recurringPosts.list()).rules).toEqual([])
    expect(await database.selectFrom('posts').select(['id']).where('uuid', '=', postUuid).executeTakeFirst()).toBeUndefined()
    expect(existsSync(join(MEDIA_DIR, `${tag}.png`))).toBe(false)

    // The account is connected again on the new install, then the archive comes in.
    await database.insertInto('social_identities').values({ uuid: crypto.randomUUID(), provider: 'bluesky', handle: `${tag}.bsky.social`, auth_status: 'connected', created_at: at }).execute()
    const report = await workspaceArchive.import(JSON.parse(JSON.stringify(archive)))
    expect(report.posts).toBeGreaterThanOrEqual(1)
    expect(report.media).toBeGreaterThanOrEqual(1)
    expect(report.composerPresets).toBe(1)
    expect(report.trackedLinks).toBe(1)
    expect(report.draftFeeds).toBe(1)
    expect(report.postingSlots).toBe(1)
    expect(report.recurringPosts).toBe(1)
    expect((await recurringPosts.list()).rules).toContainEqual(expect.objectContaining({ uuid: repeat.uuid, active: false, nextAt: repeat.nextAt }))
    expect(await listPostingSlots(accountId)).toContainEqual(slot)
    expect(await composerPresets.list()).toContainEqual(preset)
    expect(await trackedLinks.export(accountId)).toContainEqual(link)
    expect((await workspaceArchive.export()).draftFeeds).toContainEqual(feed)

    const back = await database.selectFrom('posts').select(['id']).where('uuid', '=', postUuid).executeTakeFirstOrThrow()
    const target = await database.selectFrom('post_targets').selectAll().where('post_id', '=', back.id).executeTakeFirstOrThrow()
    const reconnected = await database.selectFrom('social_identities').select(['id']).where('handle', '=', `${tag}.bsky.social`).executeTakeFirstOrThrow()
    expect(Number(target.social_identity_id)).toBe(Number(reconnected.id))
    const campaignBack = await database.selectFrom('launch_campaigns').select(['id']).where('uuid', '=', campaignUuid).executeTakeFirstOrThrow()
    const cp = await database.selectFrom('campaign_posts').selectAll().where('launch_campaign_id', '=', campaignBack.id).executeTakeFirstOrThrow()
    expect(Number(cp.post_id)).toBe(Number(back.id))
    expect(existsSync(join(MEDIA_DIR, `${tag}.png`))).toBe(true)
    const restoredWatch = await database.selectFrom('keyword_monitors').select(['id', 'twitter_read_source'])
      .where('uuid', '=', archivedWatch?.uuid).executeTakeFirstOrThrow()
    expect(restoredWatch.twitter_read_source).toBe('browser')
    expect(await keywordMonitoring.scan(Number(restoredWatch.id))).toEqual({ scanned: 0, found: 0, created: 0, errors: [] })

    // A second import changes nothing.
    const again = await workspaceArchive.import(archive)
    expect(again.posts).toBe(0)
    expect(again.composerPresets).toBe(0)
    expect(again.trackedLinks).toBe(0)
    expect(again.draftFeeds).toBe(0)
    expect(again.postingSlots).toBe(0)
    expect(again.recurringPosts).toBe(0)
    await recurringPosts.change(repeat.uuid, 'remove')
    expect(again.skipped).toBeGreaterThan(0)
  })

  test('an older archive preserves the X API default', async () => {
    const uuid = crypto.randomUUID()
    const monitor = {
      uuid, name: 'Old X watch', providers: '["twitter"]', keywords: '["Postline"]',
      match_mode: 'any', status: 'active', created_at: at, updated_at: at,
    }
    try {
      expect((await workspaceArchive.import({ format: 'postline-workspace', version: 2, monitors: [monitor] })).monitors).toBe(1)
      const row = await database.selectFrom('keyword_monitors').select('twitter_read_source').where('uuid', '=', uuid).executeTakeFirstOrThrow()
      expect(row.twitter_read_source).toBe('api')
    }
    finally {
      await database.deleteFrom('keyword_monitors').where('uuid', '=', uuid).execute()
    }
  })

  test('a version 3 archive with a missing X source is rejected before any writes', async () => {
    const uuid = crypto.randomUUID()
    await expect(workspaceArchive.import({
      format: 'postline-workspace', version: 3, monitors: [{ name: 'Missing source' }],
      posts: [{ uuid, body: 'A post that must stay out of the queue', status: 'scheduled' }],
    })).rejects.toThrow('invalid X read source')
    expect(await database.selectFrom('posts').select(['id']).where('uuid', '=', uuid).executeTakeFirst()).toBeUndefined()
  })

  test('something that is not an export is refused', async () => {
    await expect(workspaceArchive.import({ hello: 'world' })).rejects.toThrow('not a Postline workspace export')
  })

  test('invalid saved text is rejected before settings or posts are written', async () => {
    const uuid = crypto.randomUUID()
    const before = await workspaceArchive.export()
    await expect(workspaceArchive.import({
      format: 'postline-workspace', version: 4,
      settings: { workspace_name: 'Unapplied archive name' },
      posts: [{ uuid, body: 'A post that must stay out of the queue' }],
      composerPresets: [{ uuid: crypto.randomUUID(), kind: 'hashtags', name: 'Invalid tags', body: '#not-a-tag' }],
    })).rejects.toThrow('Separate hashtags')
    const after = await workspaceArchive.export()
    expect(after.settings).toEqual(before.settings)
    expect(after.posts.some(post => post.uuid === uuid)).toBe(false)
  })

  test('an invalid queued image leaves settings, posts and media untouched', async () => {
    const uuid = crypto.randomUUID()
    const file = `${uuid}.png`
    const before = await workspaceArchive.export()
    await expect(workspaceArchive.import({
      format: 'postline-workspace',
      version: 2,
      settings: { workspace_name: 'Unapplied archive name' },
      posts: [{ uuid, content: JSON.stringify({ media: [{ path: file }] }) }],
      media: { [file]: Buffer.from([1, 2, 3]).toString('base64') },
    })).rejects.toThrow('invalid queued image')
    const after = await workspaceArchive.export()
    expect(after.settings).toEqual(before.settings)
    expect(after.posts.some(post => post.uuid === uuid)).toBe(false)
    expect(existsSync(join(MEDIA_DIR, file))).toBe(false)
  })

  test('invalid attachment references are rejected before any post is imported', async () => {
    const uuid = crypto.randomUUID()
    await expect(workspaceArchive.import({
      format: 'postline-workspace',
      version: 1,
      posts: [{ uuid, content: JSON.stringify({ media: [{ path: 'nested/image.jpg' }] }) }],
    })).rejects.toThrow('invalid stored attachment reference')
    expect(await database.selectFrom('posts').select(['id']).where('uuid', '=', uuid).executeTakeFirst()).toBeUndefined()
  })
})
