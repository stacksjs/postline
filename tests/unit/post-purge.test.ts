import { describe, expect, test } from 'bun:test'
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
    expect(PURGEABLE_PROVIDERS).toEqual(['bluesky', 'twitter', 'mastodon', 'linkedin'])
    // Neither can delete a feed post through its API at all.
    expect(PURGEABLE_PROVIDERS).not.toContain('instagram')
    expect(PURGEABLE_PROVIDERS).not.toContain('threads')
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
function fakeNetwork(count: number) {
  const posts = Array.from({ length: count }, (_, index) => ({ uri: `at://me/post/${index}`, cid: `c${index}`, postedAt: '2020-01-01T00:00:00Z' }))
  const deleted: string[] = []
  const service = new PurgeService() as any
  service.accountsFor = async () => [{ id: 1, isDefault: true }]
  service.adapterFor = async () => ({
    provider: 'bluesky',
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

  test('stopping it leaves the rest of the posts alone', async () => {
    const { service, deleted } = fakeNetwork(6)
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
