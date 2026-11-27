import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { PurgeService, postPurge, PURGEABLE_PROVIDERS, purgeConfirmationFor, readPreviewToken } from '../../app/Services/Social/PurgeService'

/**
 * Purge safeguards. The per-provider delete and enumeration calls moved into
 * `@stacksjs/socials` and are pinned by its own suite
 * (stacks/tests/unit/socials-deletion.test.ts); what belongs here is the
 * app-level policy around them — what may be purged, and what has to be true
 * before anything is deleted.
 */

describe('purge safeguards', () => {
  test('only providers whose API can delete are purgeable', () => {
    expect(PURGEABLE_PROVIDERS).toEqual(['bluesky', 'twitter', 'mastodon', 'linkedin', 'threads'])
    // Neither can delete a feed post through its API at all.
    expect(PURGEABLE_PROVIDERS).not.toContain('instagram')
  })

  test('the blog is never purgeable', () => {
    // Those posts are managed from the blog itself, and deleting an essay is
    // not the same decision as clearing a feed.
    expect(PURGEABLE_PROVIDERS).not.toContain('blog')
  })

  test('refuses to execute without a preview, whatever phrase is sent', async () => {
    for (const confirmation of ['', 'DELETE ALL POSTS', 'DELETE 0 POSTS', 'yes'])
      await expect(postPurge.purge({ scope: 'all', confirmation })).rejects.toThrow('Run a preview first')
  })

  test('rejects an unknown provider before doing anything', async () => {
    await expect(postPurge.preview({ providers: ['myspace' as any] })).rejects.toThrow(/Unknown provider/)
  })

  test('reports why an unsupported provider is skipped instead of deleting', async () => {
    const result = await postPurge.preview({ providers: ['instagram'], scope: 'all' })
    const instagram = result.providers[0]

    expect(result.dryRun).toBe(true)
    expect(result.deleted).toBe(0)
    expect(instagram?.supported).toBe(false)
    expect(instagram?.matched).toBe(0)
    expect(instagram?.skippedReason).toContain('Instagram')
  })

  test('a preview never deletes, whatever the scope', async () => {
    for (const scope of ['tracked', 'all'] as const) {
      const result = await postPurge.preview({ providers: ['threads'], scope })
      expect(result.dryRun).toBe(true)
      expect(result.deleted).toBe(0)
      expect(result.failed).toBe(0)
    }
  })
})


/** A connected account with `count` posts, which records what was deleted. */
function fakeNetwork(count: number, provider = 'bluesky') {
  const posts = Array.from({ length: count }, (_, index) => ({ uri: `at://me/post/${index}`, cid: `c${index}`, postedAt: '2020-01-01T00:00:00Z' }))
  const deleted: string[] = []
  const service = new PurgeService() as any
  service.deleteDelayMs = 0
  service.accountsFor = async () => [{ id: 1, isDefault: true }]
  service.adapterFor = async () => ({
    provider,
    identityId: 1,
    handle: 'me.example.com',
    listPage: async (cursor?: string) => cursor ? { posts: [] } : { posts: posts.filter(post => !deleted.includes(post.uri)), cursor: 'next' },
    deletePost: async (ref: { uri: string }) => { deleted.push(ref.uri) },
  })
  return { service: service as PurgeService, posts, deleted }
}

describe('a run acts on the preview the owner saw', () => {
  test('the phrase is the previewed count, and the run sends the preview back', async () => {
    const { service, deleted } = fakeNetwork(3)
    const preview = await service.preview({ providers: ['bluesky'], scope: 'all' })
    expect(preview.matched).toBe(3)
    expect(preview.confirmation).toBe('DELETE 3 POSTS')
    expect(preview.previewToken).toBeString()

    await expect(service.purge({ providers: ['bluesky'], scope: 'all', confirmation: 'DELETE ALL POSTS', previewToken: preview.previewToken })).rejects.toThrow('Type "DELETE 3 POSTS"')
    expect(deleted).toEqual([])

    const result = await service.purge({ providers: ['bluesky'], scope: 'all', confirmation: 'DELETE 3 POSTS', previewToken: preview.previewToken })
    expect(result.deleted).toBe(3)
  })

  test('posts added after the preview are not deleted', async () => {
    const network = fakeNetwork(2)
    const preview = await network.service.preview({ providers: ['bluesky'], scope: 'all' })
    network.posts.push({ uri: 'at://me/post/new', cid: 'cnew', postedAt: '2020-01-01T00:00:00Z' })

    const result = await network.service.purge({ providers: ['bluesky'], scope: 'all', confirmation: purgeConfirmationFor(2), previewToken: preview.previewToken })

    expect(result.deleted).toBe(2)
    expect(network.deleted).toHaveLength(2)
    expect(network.deleted).not.toContain('at://me/post/new')
    expect(result.providers[0]!.truncated).toBe(true)
  })

  test('a preview of another selection, an old one, or a forged one is refused', () => {
    const service = new PurgeService() as any
    const expected = { scope: 'all' as const, providers: ['bluesky'], olderThanDays: null }
    const sign = (claims: Record<string, unknown>) => {
      const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
      return `${body}.${new Bun.CryptoHasher('sha256', process.env.APP_KEY || 'x').update(body).digest('base64url')}`
    }
    void service
    const fresh = { scope: 'all', providers: ['bluesky'], olderThanDays: null, matched: 5, issuedAt: Date.now() }

    expect(readPreviewToken(sign(fresh), expected).matched).toBe(5)
    expect(() => readPreviewToken(sign({ ...fresh, providers: ['twitter'] }), expected)).toThrow('selection changed')
    expect(() => readPreviewToken(sign({ ...fresh, issuedAt: Date.now() - 16 * 60_000 }), expected)).toThrow('more than 15 minutes old')
    expect(() => readPreviewToken(`${sign(fresh).split('.')[0]}.forged`, expected)).toThrow('not one this Postline made')
    expect(() => readPreviewToken('', expected)).toThrow('Run a preview first')
  })
})

describe('a run in the background', () => {
  async function settle(service: PurgeService, runId: string) {
    for (let tick = 0; tick < 200; tick++) {
      const progress = service.progress(runId)!
      if (progress.status !== 'running') return progress
      await Bun.sleep(25)
    }
    throw new Error('the run did not finish')
  }

  test('answers at once, reports progress, and finishes with the result', async () => {
    const { service, deleted } = fakeNetwork(3)
    const preview = await service.preview({ providers: ['bluesky'], scope: 'all' })

    const started = service.start({ providers: ['bluesky'], scope: 'all', confirmation: preview.confirmation, previewToken: preview.previewToken })
    expect(started.status).toBe('running')
    expect(started.limit).toBe(3)

    const done = await settle(service, started.runId)
    expect(done.status).toBe('completed')
    expect(done.deleted).toBe(3)
    expect(done.result!.deleted).toBe(3)
    expect(deleted).toHaveLength(3)
  }, 30_000)

  test('a second run while one is going is refused at once', async () => {
    const { service } = fakeNetwork(3)
    const preview = await service.preview({ providers: ['bluesky'], scope: 'all' })
    const first = service.start({ providers: ['bluesky'], scope: 'all', confirmation: preview.confirmation, previewToken: preview.previewToken })

    expect(() => service.start({ providers: ['bluesky'], scope: 'all', confirmation: preview.confirmation, previewToken: preview.previewToken })).toThrow('already in progress')
    await settle(service, first.runId)
  }, 30_000)

  test('an automatic cleanup cannot overlap a confirmed API cleanup', async () => {
    const manual = fakeNetwork(3)
    const scheduled = fakeNetwork(3)
    const preview = await manual.service.preview({ providers: ['bluesky'], scope: 'all' })
    const running = manual.service.start({ providers: ['bluesky'], scope: 'all', confirmation: preview.confirmation, previewToken: preview.previewToken })
    await expect(scheduled.service.purgeOlderThan({ providers: ['bluesky'], scope: 'all', olderThanDays: 30 })).rejects.toThrow('already in progress')
    expect(scheduled.deleted).toEqual([])
    expect((await settle(manual.service, running.runId)).deleted).toBe(3)
  })

  test('stopping it leaves the rest of the posts alone', async () => {
    const { service, deleted } = fakeNetwork(6)
    // The real pause between deletes, so there is time to stop after the first.
    ;(service as any).deleteDelayMs = 250
    const preview = await service.preview({ providers: ['bluesky'], scope: 'all' })
    const started = service.start({ providers: ['bluesky'], scope: 'all', confirmation: preview.confirmation, previewToken: preview.previewToken })

    // Deletions are a quarter second apart; stop after the first.
    while (service.progress(started.runId)!.deleted < 1) await Bun.sleep(10)
    expect(service.cancel(started.runId)).toBe(true)
    const done = await settle(service, started.runId)

    expect(done.status).toBe('cancelled')
    expect(deleted.length).toBeLessThan(6)
    expect(service.cancel(started.runId)).toBe(false)
  }, 30_000)

  test('a run with the wrong phrase never starts', () => {
    const { service } = fakeNetwork(1)
    expect(() => service.start({ providers: ['bluesky'], scope: 'all', confirmation: 'DELETE ALL POSTS' })).toThrow('Run a preview first')
  })
})

describe('a network with a daily cap', () => {
  test('Threads deletes no more than what is left of its 100 a day, and says so', async () => {
    await (db as any).insertInto('purge_runs').values({
      uuid: crypto.randomUUID(),
      provider: 'threads',
      handle: 'me.example.com',
      scope: 'tracked',
      mode: 'execute',
      status: 'completed',
      matched_count: 30,
      deleted_count: 30,
      failed_count: 0,
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    }).execute()

    const network = fakeNetwork(150, 'threads')
    const preview = await network.service.preview({ providers: ['threads'], scope: 'all' })
    const row = preview.providers[0]!

    expect(row.dailyLimit).toEqual({ limit: 100, remaining: 70 })
    expect(row.matched).toBe(70)
    expect(row.truncated).toBe(true)

    const result = await network.service.purge({ providers: ['threads'], scope: 'all', confirmation: purgeConfirmationFor(70), previewToken: preview.previewToken })
    expect(result.deleted).toBe(70)
    expect(network.deleted).toHaveLength(70)
  })
})

describe('delete pacing per network (#136)', () => {
  test('X is paced to its 50 deletes per 15 minutes; others keep the default pause', async () => {
    const { deletePause } = await import('../../app/Services/Social/PurgeService')
    expect(deletePause('twitter')).toBe(18_000)
    expect(deletePause('bluesky')).toBe(250)
    expect(deletePause('mastodon', 400)).toBe(400)
  })
})
