/**
 * An export from one install imports cleanly into another (#209).
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '@stacksjs/database'
import { DELETE_EVERYTHING_PHRASE, workspaceArchive } from '../../app/Services/WorkspaceArchiveService'
import { MEDIA_DIR } from '../../app/Support/Social/uploads'

const database = db as any
const at = '2026-11-20 10:00:00'

describe('workspace archive', () => {
  test('the media folder in tests is not the project\'s', () => {
    expect(MEDIA_DIR).not.toContain(process.cwd())
  })

  test('export, delete everything, import: the same workspace comes back, links intact', async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    await database.insertInto('social_identities').values({ uuid: crypto.randomUUID(), provider: 'bluesky', handle: `${tag}.bsky.social`, auth_status: 'connected', created_at: at }).execute()
    const identity = await database.selectFrom('social_identities').select(['id']).where('handle', '=', `${tag}.bsky.social`).executeTakeFirstOrThrow()
    await Bun.write(join(MEDIA_DIR, `${tag}.jpg`), new Uint8Array([1, 2, 3]))
    const postUuid = crypto.randomUUID()
    await database.insertInto('posts').values({ uuid: postUuid, title: tag, body: `post ${tag}`, status: 'published', content: JSON.stringify({ media: [{ path: `${tag}.jpg`, mimeType: 'image/jpeg' }] }), published_at: at, created_at: at }).execute()
    const post = await database.selectFrom('posts').select(['id']).where('uuid', '=', postUuid).executeTakeFirstOrThrow()
    await database.insertInto('post_targets').values({ uuid: crypto.randomUUID(), provider: 'bluesky', status: 'published', remote_uri: `at://${tag}`, post_id: post.id, social_identity_id: identity.id, created_at: at }).execute()
    const campaignUuid = crypto.randomUUID()
    await database.insertInto('launch_campaigns').values({ uuid: campaignUuid, name: `Campaign ${tag}`, tone: 'clear', status: 'draft', start_date: '2026-12-01', end_date: '2026-12-10', created_at: at }).execute()
    const campaign = await database.selectFrom('launch_campaigns').select(['id']).where('uuid', '=', campaignUuid).executeTakeFirstOrThrow()
    await database.insertInto('campaign_posts').values({ uuid: crypto.randomUUID(), title: 'cp', body: 'campaign post', providers: '["bluesky"]', pillar: 'story', status: 'idea', scheduled_at: '2026-12-02 09:00:00', position: 0, launch_campaign_id: campaign.id, post_id: post.id, created_at: at }).execute()

    const archive = await workspaceArchive.export()
    expect(archive.posts.some(row => row.uuid === postUuid)).toBe(true)
    expect(archive.media[`${tag}.jpg`]).toBe(Buffer.from([1, 2, 3]).toString('base64'))
    expect(JSON.stringify(archive)).not.toContain('access_token')

    await expect(workspaceArchive.deleteEverything('delete everything')).rejects.toThrow(DELETE_EVERYTHING_PHRASE)
    await workspaceArchive.deleteEverything(DELETE_EVERYTHING_PHRASE)
    expect(await database.selectFrom('posts').select(['id']).where('uuid', '=', postUuid).executeTakeFirst()).toBeUndefined()
    expect(existsSync(join(MEDIA_DIR, `${tag}.jpg`))).toBe(false)

    // The account is connected again on the new install, then the archive comes in.
    await database.insertInto('social_identities').values({ uuid: crypto.randomUUID(), provider: 'bluesky', handle: `${tag}.bsky.social`, auth_status: 'connected', created_at: at }).execute()
    const report = await workspaceArchive.import(JSON.parse(JSON.stringify(archive)))
    expect(report.posts).toBeGreaterThanOrEqual(1)
    expect(report.media).toBeGreaterThanOrEqual(1)

    const back = await database.selectFrom('posts').select(['id']).where('uuid', '=', postUuid).executeTakeFirstOrThrow()
    const target = await database.selectFrom('post_targets').selectAll().where('post_id', '=', back.id).executeTakeFirstOrThrow()
    const reconnected = await database.selectFrom('social_identities').select(['id']).where('handle', '=', `${tag}.bsky.social`).executeTakeFirstOrThrow()
    expect(Number(target.social_identity_id)).toBe(Number(reconnected.id))
    const campaignBack = await database.selectFrom('launch_campaigns').select(['id']).where('uuid', '=', campaignUuid).executeTakeFirstOrThrow()
    const cp = await database.selectFrom('campaign_posts').selectAll().where('launch_campaign_id', '=', campaignBack.id).executeTakeFirstOrThrow()
    expect(Number(cp.post_id)).toBe(Number(back.id))
    expect(existsSync(join(MEDIA_DIR, `${tag}.jpg`))).toBe(true)

    // A second import changes nothing.
    const again = await workspaceArchive.import(archive)
    expect(again.posts).toBe(0)
    expect(again.skipped).toBeGreaterThan(0)
  })

  test('something that is not an export is refused', async () => {
    await expect(workspaceArchive.import({ hello: 'world' })).rejects.toThrow('not a Postline workspace export')
  })
})
