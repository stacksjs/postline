/**
 * Engagement sync on a fresh install (#202): nothing published to Bluesky is
 * nothing to do, not a failure to log every half hour.
 */
import { describe, expect, spyOn, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { networkApps } from '../../app/Services/NetworkAppService'
import { bluesky } from '../../app/Services/Social/BlueskyService'
import { ThreadsDriver } from '../../app/Services/Social/Drivers/ThreadsDriver'
import { syncEngagement } from '../../app/Services/Social/EngagementService'
import { instagram } from '../../app/Services/Social/InstagramService'
import { linkedin } from '../../app/Services/Social/LinkedInService'
import { threads } from '../../app/Services/Social/ThreadsService'
import { mastodon } from '../../app/Services/Social/MastodonService'
import { postQueue } from '../../app/Services/Social/QueueService'
import { findIdentityRow, revokeIdentityRow, upsertIdentityRow } from '../../app/Services/Social/identities'

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

describe('optional engagement drivers', () => {
  test('read only the owning account, report permission failures, and retain an empty response’s last measured counts', async () => {
    const realFetch = globalThis.fetch
    const identities: number[] = []
    const posts: number[] = []
    const requests: Array<{ url: URL, authorization: string | null }> = []
    const services = { instagram, linkedin, threads }
    const sources = [
      { provider: 'instagram', account: '400', uri: '401', scope: 'instagram_manage_insights' },
      { provider: 'linkedin', account: 'urn:li:organization:500', uri: 'urn:li:share:501', scope: 'r_organization_social_feed' },
      { provider: 'threads', account: '600', uri: '601', scope: 'threads_manage_insights' },
    ] as const

    async function observedPost(provider: keyof typeof services, account: string, uri: string, previous: object | null = null, legacy = false): Promise<number> {
      const row = await upsertIdentityRow(provider, { externalId: account }, {
        handle: account, external_id: account, auth_status: 'connected', access_token: 'test-' + account,
      })
      const id = Number(row.id)
      identities.push(id)
      const { postId } = await postQueue.save({ text: 'Metrics from ' + provider, providers: [`${provider}:${id}`] })
      posts.push(postId)
      await database.updateTable('post_targets').set({
        status: 'published',
        remote_uri: uri,
        social_identity_id: legacy ? null : id,
        metrics: previous ? JSON.stringify(previous) : null,
      }).where('post_id', '=', postId).execute()
      return postId
    }

    async function savedCounts(postId: number) {
      const target = await database.selectFrom('post_targets').select('metrics').where('post_id', '=', postId).executeTakeFirstOrThrow()
      return target.metrics ? JSON.parse(target.metrics) : null
    }

    try {
      for (const { provider, scope } of sources) {
        await networkApps.save(provider, { clientId: 'test-client', clientSecret: 'test-secret', organizationPages: provider === 'linkedin' })
        expect(new URL(await services[provider].getAuthUrl()).searchParams.get('scope')).not.toContain(scope)
        await networkApps.save(provider, { clientId: 'test-client', engagementMetrics: true })
        expect(new URL(await services[provider].getAuthUrl()).searchParams.get('scope')).toContain(scope)
      }
      const [ig, li, th] = await Promise.all(sources.map(source => observedPost(source.provider, source.account, source.uri)))
      const missing = await observedPost('instagram', '402', '403', { likes: 2 })
      const denied = await observedPost('threads', '602', '603', { replies: 7 })
      const legacy = await observedPost('threads', '604', '605', { replies: 6 }, true)
      globalThis.fetch = (async (input, init) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        requests.push({ url, authorization: request.headers.get('authorization') })
        if (url.host === 'api.linkedin.com' && url.pathname === '/rest/socialMetadata')
          return Response.json({ results: { 'urn:li:share:501': { reactionSummaries: { LIKE: { count: 7 }, PRAISE: { count: 2 } }, commentSummary: { count: 4 } } } })
        if (url.host === 'graph.facebook.com' && url.pathname.endsWith('/401/insights'))
          return Response.json({ data: [{ name: 'likes', values: [{ value: 3 }] }, { name: 'comments', values: [{ value: 1 }] }] })
        if (url.host === 'graph.facebook.com' && url.pathname.endsWith('/403/insights'))
          return Response.json({ data: [] })
        if (url.host === 'graph.threads.net' && url.pathname.endsWith('/601/insights'))
          return Response.json({ data: [{ name: 'replies', values: [{ value: 2 }] }, { name: 'reposts', values: [{ value: 0 }] }] })
        if (url.host === 'graph.threads.net' && url.pathname.endsWith('/603/insights'))
          return Response.json({ error: { message: 'Missing insights permission', code: 10 } }, { status: 403 })
        throw new Error('Unexpected request during engagement sync')
      }) as typeof fetch

      expect(await syncEngagement()).toMatchObject({
        synced: 3,
        errors: [{ provider: 'threads', explanation: expect.stringContaining('read engagement metrics') }],
      })
      expect(requests.map(({ authorization }) => authorization).sort()).toEqual(['400', '402', '600', '602', 'urn:li:organization:500'].map(account => 'Bearer test-' + account))
      expect(requests.some(({ url }) => url.searchParams.get('ids') === 'List(urn:li:share:501)')).toBe(true)
      expect(await savedCounts(ig!)).toMatchObject({ likes: 3, replies: 1 })
      expect(await savedCounts(ig!)).not.toHaveProperty('reposts')
      expect(await savedCounts(li!)).toMatchObject({ likes: 9, replies: 4 })
      expect(await savedCounts(th!)).toMatchObject({ replies: 2, reposts: 0 })
      expect(await savedCounts(missing)).toEqual({ likes: 2 })
      expect(await savedCounts(denied)).toEqual({ replies: 7 })
      expect(await savedCounts(legacy)).toEqual({ replies: 6 })
    }
    finally {
      globalThis.fetch = realFetch
      if (posts.length) {
        await database.deleteFrom('post_targets').where('post_id', 'in', posts).execute()
        await database.deleteFrom('posts').where('id', 'in', posts).execute()
      }
      if (identities.length) await database.deleteFrom('social_identities').where('id', 'in', identities).execute()
      for (const { provider } of sources) await networkApps.clear(provider)
    }
  })

  test('a credential revoked while renewing is never used for a metrics read', async () => {
    const began = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<{ accessToken: string, expiresIn: number }>()
    const renewal = spyOn(ThreadsDriver.prototype, 'refreshLongLivedToken').mockImplementation(async () => {
      began.resolve()
      return await finish.promise
    })
    const metrics = spyOn(ThreadsDriver.prototype, 'metrics').mockResolvedValue([])
    const account = await upsertIdentityRow('threads', { externalId: '701' }, {
      handle: 'renewal-race', external_id: '701', access_token: 'old-access',
      auth_status: 'connected', token_expires_at: '2000-01-01 00:00:00',
    })
    const { postId } = await postQueue.save({ text: 'Metrics renewal race fixture', providers: [`threads:${account.id}`] })
    await database.updateTable('post_targets').set({ status: 'published', remote_uri: '702' }).where('post_id', '=', postId).execute()
    await networkApps.save('threads', { clientId: 'test-client', clientSecret: 'test-secret', engagementMetrics: true })

    const sync = threads.syncMetrics()
    try {
      await began.promise
      await revokeIdentityRow('threads', account.id)
      finish.resolve({ accessToken: 'late-token', expiresIn: 3600 })

      expect(await sync).toEqual({ synced: 0 })
      expect(metrics).not.toHaveBeenCalled()
      expect(await findIdentityRow('threads', account.id)).toMatchObject({ auth_status: 'revoked', access_token: null })
    }
    finally {
      finish.resolve({ accessToken: 'late-token', expiresIn: 3600 })
      await sync.catch(() => {})
      renewal.mockRestore()
      metrics.mockRestore()
      await database.deleteFrom('post_targets').where('post_id', '=', postId).execute()
      await database.deleteFrom('posts').where('id', '=', postId).execute()
      await database.deleteFrom('social_identities').where('id', '=', account.id).execute()
      await networkApps.clear('threads')
    }
  })

})
