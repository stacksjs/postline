/**
 * An export from one install imports cleanly into another (#209).
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { db } from '@stacksjs/database'
import { composerPresets } from '../../app/Services/ComposerPresetService'
import { draftFeeds } from '../../app/Services/DraftFeedService'
import { changePostingSlot, listPostingSlots } from '../../app/Services/PostingSlotService'
import { keywordMonitoring } from '../../app/Services/KeywordMonitoringService'
import { recurringPosts } from '../../app/Services/RecurringPostService'
import { CrosspostService } from '../../app/Services/Social/CrosspostService'
import { postQueue, QueueService } from '../../app/Services/Social/QueueService'
import { ensureAccount } from '../../app/Services/Social/support'
import { rememberTwitterBrowserHandle, twitterBrowserSession } from '../../app/Services/Social/TwitterBrowserSession'
import { trackedLinks } from '../../app/Services/TrackedLinkService'
import { DELETE_EVERYTHING_PHRASE, workspaceArchive } from '../../app/Services/WorkspaceArchiveService'
import { wallTimeInZone } from '../../app/Support/time'
import { workspace } from '../../app/Services/WorkspaceService'
import { MEDIA_DIR, mediaDirectory } from '../../app/Support/Social/uploads'

const database = db as any
const at = '2026-11-20 10:00:00'
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='

describe('workspace archive', () => {
  test('archive tests use disposable media storage', () => {
    expect(basename(dirname(MEDIA_DIR))).toStartWith(`postline-test-${process.pid}-`)
    expect(MEDIA_DIR).not.toBe(mediaDirectory({}, process.cwd()))
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
    expect(archive.version).toBe(9)
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

  test('restores queue rows, settings and attachments together when retried after a failed target insert', async () => {
    const tag = crypto.randomUUID()
    const filename = `${tag}.png`
    const path = join(MEDIA_DIR, filename)
    const targetUuid = crypto.randomUUID()
    const before = (await workspaceArchive.export()).settings
    const target = { uuid: targetUuid, post: tag, provider: 'blog', account: null, status: 'scheduled', attempts: 0, created_at: at, updated_at: at }
    const archive = {
      format: 'postline-workspace',
      version: 1,
      settings: { workspace_name: 'Queue import fixture' },
      posts: [{ uuid: tag, body: tag, status: 'scheduled', scheduled_at: '2099-01-01 10:00:00', timezone: 'UTC', source: 'composer', created_at: at, updated_at: at, content: JSON.stringify({ media: [{ path: filename, mimeType: 'image/png' }] }) }],
      targets: [target],
      media: { [filename]: png },
    }

    try {
      await expect(workspaceArchive.import({ ...archive, targets: [...archive.targets, { ...target, uuid: crypto.randomUUID(), status: null }] })).rejects.toThrow('post_targets.status')
      expect(await database.selectFrom('posts').select('id').where('uuid', '=', tag).executeTakeFirst()).toBeUndefined()
      expect(await database.selectFrom('post_targets').select('id').where('uuid', '=', targetUuid).executeTakeFirst()).toBeUndefined()
      expect((await workspaceArchive.export()).settings).toEqual(before)
      expect(existsSync(path)).toBe(false)

      const reports = await Promise.all([workspaceArchive.import(archive), workspaceArchive.import(archive)])
      expect(reports.map(report => report.posts).sort()).toEqual([0, 1])
      expect(reports.map(report => report.targets).sort()).toEqual([0, 1])
      expect(reports.map(report => report.media).sort()).toEqual([0, 1])
      expect(Buffer.from(await Bun.file(path).arrayBuffer()).toString('base64')).toBe(png)
    }
    finally {
      await database.deleteFrom('post_targets').where('uuid', '=', targetUuid).execute()
      await database.deleteFrom('posts').where('uuid', '=', tag).execute()
      await workspaceArchive.import({ format: 'postline-workspace', version: 1, settings: before })
      if (existsSync(path)) await Bun.file(path).delete()
    }
  })

  test('a restored named target waits for the original account instead of sending to the default', async () => {
    const tag = crypto.randomUUID()
    const original = { provider: 'bluesky', handle: `${tag}.bsky.social`, externalId: `did:plc:${tag}` }
    const second = { provider: 'bluesky', handle: `second-${tag}.bsky.social` }
    const connect = async (handle: string, externalId: string | null, isDefault = false) => (await database
      .insertInto('social_identities').values({
        uuid: crypto.randomUUID(), provider: 'bluesky', handle, external_id: externalId, auth_status: 'connected', is_default: isDefault,
      }).returning('id').executeTakeFirstOrThrow()).id
    const other = await connect(original.handle, `did:plc:other-${tag}`, true)
    const secondId = await connect(second.handle.toUpperCase(), null)
    const sends: Array<number | null | undefined> = []
    const service = new CrosspostService({
      bluesky: {
        defaultIdentityId: async () => other,
        // eslint-disable-next-line unused-imports/no-unused-vars
        async publishToPost(post, content, identityId) {
          sends.push(identityId)
          await database.insertInto('post_targets').values({
            uuid: crypto.randomUUID(), post_id: post.id, provider: 'bluesky', status: 'published', social_identity_id: identityId,
          }).execute()
          return { provider: 'bluesky', ok: true, identityId: identityId ?? undefined }
        },
      },
    })
    const queue = new QueueService(service)
    const scheduled = new Date(Date.now() - 10_000).toISOString().slice(0, 19).replace('T', ' ')
    const archive = {
      format: 'postline-workspace',
      version: 1,
      posts: [{ uuid: tag, body: 'Restored queue fixture', status: 'scheduled', scheduled_at: scheduled, timezone: 'UTC', source: 'composer', created_at: at, updated_at: at }],
      targets: [original, second].map(account => ({
        uuid: crypto.randomUUID(), post: tag, provider: account.provider, account, status: 'scheduled', attempts: 0, created_at: at, updated_at: at,
      })),
    }
    let restoredId: number | undefined
    let originalId: number | undefined

    try {
      await workspaceArchive.import(archive)
      restoredId = Number((await database.selectFrom('posts').select('id').where('uuid', '=', tag).executeTakeFirstOrThrow()).id)
      expect((await workspaceArchive.export()).targets.find(target => target.uuid === archive.targets[0]?.uuid)?.account).toEqual(original)
      expect((await queue.get(restoredId)).targets).toEqual([`bluesky:${secondId}`])
      await expect(queue.publishNow(restoredId)).rejects.toThrow(`Reconnect ${original.handle}`)
      await queue.publishDue()
      expect(sends).toEqual([])
      const item = (await queue.listPage({ limit: 500 })).items.find(item => item.id === restoredId)
      expect(item?.status).toBe('failed')
      expect(item?.providers).toContainEqual(expect.objectContaining({ handle: original.handle, failureReason: expect.stringContaining('Reconnect') }))

      originalId = await connect(`renamed-${tag}.bsky.social`, original.externalId)
      await queue.publishNow(restoredId)
      expect(sends).toEqual([originalId, secondId])
    }
    finally {
      if (restoredId) {
        await database.deleteFrom('post_targets').where('post_id', '=', restoredId).execute()
        await database.deleteFrom('posts').where('id', '=', restoredId).execute()
      }
      await database.deleteFrom('social_identities').where('id', 'in', [other, secondId, ...(originalId ? [originalId] : [])]).execute()
    }
  })

  test('a restored thread resumes from its published parent after the named account reconnects', async () => {
    const threadKey = crypto.randomUUID()
    const account = { provider: 'bluesky', handle: `${threadKey}.bsky.social` }
    const rootUri = 'at://did:plc:archive/app.bsky.feed.post/root'
    const uuids = [crypto.randomUUID(), crypto.randomUUID()]
    const sends: Array<{ id: number, accountId?: number | null, parent?: string }> = []
    const service = new CrosspostService({
      bluesky: {
        async publishToPost(post, content, accountId) {
          sends.push({ id: post.id, accountId, parent: content?.reply?.parent?.uri })
          await database.insertInto('post_targets').values({
            uuid: crypto.randomUUID(), post_id: post.id, provider: account.provider, status: 'published', social_identity_id: accountId,
          }).execute()
          return { provider: 'bluesky', ok: true, identityId: accountId ?? undefined }
        },
      },
    })
    const archive = {
      format: 'postline-workspace',
      version: 1,
      posts: uuids.map((uuid, index) => ({
        uuid, thread_key: threadKey, body: index ? 'Second segment' : 'First segment', status: index ? 'failed' : 'published',
        timezone: 'UTC', source: 'composer', created_at: at, updated_at: at,
      })),
      targets: uuids.map((post, index) => ({
        uuid: crypto.randomUUID(), post, provider: account.provider, account, status: index ? 'failed' : 'published',
        remote_uri: index ? null : rootUri, remote_cid: index ? null : 'root-cid', attempts: 0, created_at: at, updated_at: at,
      })),
    }
    let accountId: number | undefined
    try {
      await workspaceArchive.import(archive)
      await expect(service.resumeThread(threadKey)).rejects.toThrow(`Reconnect ${account.handle}`)
      expect(sends).toEqual([])
      accountId = (await database.insertInto('social_identities').values({
        uuid: crypto.randomUUID(), ...account, auth_status: 'connected',
      }).returning('id').executeTakeFirstOrThrow()).id
      const reply = await database.selectFrom('posts').select('id').where('uuid', '=', uuids[1]).executeTakeFirstOrThrow()
      await new QueueService(service).publishNow(Number(reply.id))
      expect(sends).toEqual([{ id: Number(reply.id), accountId, parent: rootUri }])
    }
    finally {
      const rows: Array<{ id: number }> = await database.selectFrom('posts').select('id').where('thread_key', '=', threadKey).execute()
      if (rows.length) await database.deleteFrom('post_targets').where('post_id', 'in', rows.map(row => row.id)).execute()
      await database.deleteFrom('posts').where('thread_key', '=', threadKey).execute()
      if (accountId) await database.deleteFrom('social_identities').where('id', '=', accountId).execute()
    }
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
