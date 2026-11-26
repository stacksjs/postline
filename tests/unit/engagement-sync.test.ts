/**
 * Engagement sync on a fresh install (#202): nothing published to Bluesky is
 * nothing to do, not a failure to log every half hour.
 */
import { describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { bluesky } from '../../app/Services/Social/BlueskyService'
import { syncEngagement } from '../../app/Services/Social/EngagementService'
import { mastodon } from '../../app/Services/Social/MastodonService'
import { postQueue } from '../../app/Services/Social/QueueService'
import { upsertIdentityRow } from '../../app/Services/Social/identities'

const database = db as any

describe('engagement sync', () => {
  test('with no Bluesky account and nothing published, it has nothing to do', async () => {
    await database.deleteFrom('post_targets').where('provider', '=', 'bluesky').execute()
    await database.deleteFrom('social_identities').where('provider', '=', 'bluesky').execute()
    const before = { id: process.env.BLUESKY_IDENTIFIER, password: process.env.BLUESKY_APP_PASSWORD }
    delete process.env.BLUESKY_IDENTIFIER
    delete process.env.BLUESKY_APP_PASSWORD
    try {
      expect(await bluesky.syncMetrics()).toEqual({ synced: 0 })
    }
    finally {
      if (before.id !== undefined) process.env.BLUESKY_IDENTIFIER = before.id
      if (before.password !== undefined) process.env.BLUESKY_APP_PASSWORD = before.password
    }
  })
})

describe('Mastodon engagement sync', () => {
  test('uses each publishing account and keeps counts when a private post is missing from the response', async () => {
    const firstHost = 'https://metrics-one.example'
    const secondHost = 'https://metrics-two.example'
    const realFetch = globalThis.fetch
    const posts: number[] = []
    const identities: number[] = []
    const requests: Array<{ origin: string, ids: string[], authorization: string | null }> = []

    async function connect(instance: string, handle: string, token: string): Promise<number> {
      const row = await upsertIdentityRow('mastodon', { handle }, {
        handle,
        external_id: instance,
        auth_status: 'connected',
        access_token: token,
      })
      const id = Number(row.id)
      identities.push(id)
      return id
    }

    async function published(account: number, origin: string, remoteId: string, legacy = false): Promise<number> {
      const { postId } = await postQueue.save({ text: 'Mastodon metrics fixture ' + remoteId, providers: [`mastodon:${account}`] })
      posts.push(postId)
      await database.updateTable('post_targets').set({
        status: 'published',
        remote_uri: `${origin}/@postline/${remoteId}`,
        remote_cid: legacy ? null : remoteId,
        social_identity_id: legacy ? null : account,
        metrics: legacy ? JSON.stringify({ likes: 7, reposts: 0, replies: 0 }) : null,
      }).where('post_id', '=', postId).execute()
      return postId
    }

    async function metrics(postId: number) {
      const target = await database.selectFrom('post_targets').select(['metrics']).where('post_id', '=', postId).executeTakeFirstOrThrow()
      return target.metrics ? JSON.parse(target.metrics) : null
    }

    try {
      const firstAccount = await connect(firstHost, '@postline@metrics-one.example', 'first-test-token')
      const secondAccount = await connect(secondHost, '@postline@metrics-two.example', 'second-test-token')
      const first = await published(firstAccount, firstHost, '41')
      const second = await published(secondAccount, secondHost, '41')
      const older = await published(firstAccount, firstHost, '42', true)
      let refuseSecond = false
      globalThis.fetch = (async (input, init) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        if (![firstHost, secondHost].includes(url.origin) || url.pathname !== '/api/v1/statuses')
          throw new Error('Unexpected request during Mastodon metrics test')
        requests.push({ origin: url.origin, ids: url.searchParams.getAll('id[]'), authorization: request.headers.get('authorization') })
        if (url.origin === secondHost && refuseSecond) return Response.json({ error: 'Missing read scope' }, { status: 403 })
        return Response.json([{ id: '41', favourites_count: url.origin === firstHost ? 4 : 9, reblogs_count: 1, replies_count: 2 }])
      }) as typeof fetch

      expect(await mastodon.syncMetrics()).toEqual({ synced: 2 })
      expect(requests).toContainEqual({ origin: firstHost, ids: ['41', '42'], authorization: 'Bearer first-test-token' })
      expect(requests).toContainEqual({ origin: secondHost, ids: ['41'], authorization: 'Bearer second-test-token' })
      expect(await metrics(first)).toMatchObject({ likes: 4, reposts: 1, replies: 2 })
      expect(await metrics(second)).toMatchObject({ likes: 9, reposts: 1, replies: 2 })
      expect(await metrics(older)).toMatchObject({ likes: 7 })

      refuseSecond = true
      expect(await syncEngagement()).toMatchObject({
        synced: 1,
        errors: [{ provider: 'mastodon', explanation: expect.stringContaining('read engagement metrics') }],
      })
      expect(await metrics(second)).toMatchObject({ likes: 9, reposts: 1, replies: 2 })
    }
    finally {
      globalThis.fetch = realFetch
      if (posts.length) {
        await database.deleteFrom('post_targets').where('post_id', 'in', posts).execute()
        await database.deleteFrom('posts').where('id', 'in', posts).execute()
      }
      if (identities.length) await database.deleteFrom('social_identities').where('id', 'in', identities).execute()
    }
  })
})
