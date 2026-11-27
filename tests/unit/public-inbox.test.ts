import type { PublishContent } from '../../app/Support/Social/types'
import type { PublicNotification } from '../../app/Services/Social/public-notifications'
import { afterEach, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { CrosspostService } from '../../app/Services/Social/CrosspostService'
import { QueueService } from '../../app/Services/Social/QueueService'
import { PublicInboxService } from '../../app/Services/PublicInboxService'
import { upsertIdentityRow } from '../../app/Services/Social/identities'
import { blueskyNotification, blueskyReplyParent, mastodonNotification, mastodonReplyParent } from '../../app/Services/Social/public-notifications'

const identities: number[] = []

async function account(): Promise<number> {
  const handle = `inbox-${crypto.randomUUID()}.example`
  const identity = await upsertIdentityRow('bluesky', { handle }, {
    handle,
    access_token: 'fixture-token',
    auth_status: 'connected',
  })
  identities.push(Number(identity.id))
  return Number(identity.id)
}

afterEach(async () => {
  if (!identities.length) return
  await db.deleteFrom('inbox_mentions').where('social_identity_id', 'in', identities).execute()
  await db.deleteFrom('social_identities').where('id', 'in', identities).execute()
  identities.length = 0
})

function mention(body: string): PublicNotification {
  return {
    remoteId: crypto.randomUUID(),
    kind: 'mention',
    author: 'author.example',
    body,
    url: 'https://bsky.app/profile/author.example/post/123',
    postedAt: new Date().toISOString(),
  }
}

describe('public inbox notifications', () => {
  test('maps replies and mentions from the author’s Bluesky post', () => {
    const entry = {
      uri: 'at://did:plc:author/app.bsky.feed.post/abc',
      reason: 'reply',
      author: { did: 'did:plc:author', handle: 'author.example' },
      record: { text: 'A reply' },
      indexedAt: '2026-11-26T12:30:00Z',
    }
    expect(blueskyNotification(entry)).toEqual({
      remoteId: entry.uri,
      kind: 'reply',
      author: 'author.example',
      body: 'A reply',
      url: 'https://bsky.app/profile/did%3Aplc%3Aauthor/post/abc',
      postedAt: entry.indexedAt,
    })
    expect(blueskyNotification({ ...entry, reason: 'like' })).toBeUndefined()
    expect(blueskyNotification({ ...entry, author: { ...entry.author, did: 'did:plc:other' } })).toBeUndefined()
  })

  test('keeps publicly accessible Mastodon conversations and strips markup', () => {
    const entry = {
      id: '42',
      type: 'mention',
      account: { acct: 'friend@example.social' },
      status: {
        url: null,
        uri: 'https://example.social/@friend/42',
        visibility: 'unlisted',
        content: '<p>Hello <strong>world</strong></p>',
        created_at: '2026-11-26T12:30:00Z',
        in_reply_to_id: '41',
      },
    }
    expect(mastodonNotification(entry)).toEqual({
      remoteId: '42',
      kind: 'reply',
      author: 'friend@example.social',
      body: 'Hello world',
      url: entry.status.uri,
      postedAt: entry.status.created_at,
    })
    expect(mastodonNotification({ ...entry, status: { ...entry.status, in_reply_to_id: null } })?.kind).toBe('mention')
    expect(mastodonNotification({ ...entry, status: { ...entry.status, spoiler_text: 'Spoilers' } })?.body).toBe('Content warning · Spoilers')
    for (const visibility of ['private', 'direct'])
      expect(mastodonNotification({ ...entry, status: { ...entry.status, visibility } })).toBeUndefined()
    expect(mastodonNotification({ ...entry, status: { ...entry.status, url: 'file:///example' } })).toBeUndefined()
  })
})

describe('public inbox sync', () => {
  test('keeps independent read state for the same notification on two accounts', async () => {
    const first = await account()
    const second = await account()
    const item = mention(`Seen by two accounts ${first}`)
    const service = new PublicInboxService(async (_, identityId) => ({
      items: identityId === first || identityId === second ? [item] : [],
    }))

    expect(await service.sync()).toEqual({ added: 2, errors: [] })
    const saved = (await service.list()).entries.filter(entry => entry.body === item.body)
    expect(saved).toHaveLength(2)
    expect(new Set(saved.map(entry => entry.account)).size).toBe(2)
    await service.markRead(saved[0]!.id)
    expect(await service.sync()).toEqual({ added: 0, errors: [] })
    const reread = (await service.list()).entries.filter(entry => entry.body === item.body)
    expect(reread.map(entry => entry.read)).toEqual([true, false])
  })

  test('leaves the previous sync boundary in place when the next page fails', async () => {
    const identity = await account()
    const existing = mention(`Previously synced ${identity}`)
    const latest = mention(`Latest mention ${identity}`)
    const older = mention(`Older unseen reply ${identity}`)
    let phase = 'initial'
    const cursors: Array<string | undefined> = []
    const service = new PublicInboxService(async (_, identityId, cursor) => {
      if (identityId !== identity) return { items: [] }
      cursors.push(cursor)
      if (phase === 'initial') return { items: [existing] }
      if (!cursor) return { items: [latest], next: 'remaining-page' }
      if (phase === 'failure') throw new Error('The remote network is unavailable.')
      return { items: [older, existing] }
    })

    expect(await service.sync()).toEqual({ added: 1, errors: [] })
    phase = 'failure'
    expect(await service.sync()).toMatchObject({ added: 0, errors: [{ message: 'The remote network is unavailable.' }] })
    expect((await service.list()).entries.some(entry => entry.body === latest.body)).toBe(false)
    phase = 'retry'
    expect(await service.sync()).toEqual({ added: 2, errors: [] })
    expect(cursors).toEqual([undefined, undefined, 'remaining-page', undefined, 'remaining-page'])
    const bodies = (await service.list()).entries.map(entry => entry.body)
    expect(bodies).toEqual(expect.arrayContaining([existing.body, latest.body, older.body]))
  })

  test('continues collecting the latest notifications after a long time offline', async () => {
    const identity = await account()
    const backlog = Array.from({ length: 13 }, (_, index) => mention(`Backlog item ${identity}-${index}`))
    let offline = false
    let requests = 0
    const service = new PublicInboxService(async (_, identityId, cursor) => {
      if (identityId !== identity) return { items: [] }
      if (!offline) return { items: [mention(`Previously synced ${identity}`)] }
      requests++
      const index = Number(cursor || 0)
      return { items: [backlog[index]!], next: String(index + 1) }
    })

    expect(await service.sync()).toEqual({ added: 1, errors: [] })
    offline = true
    expect(await service.sync()).toEqual({ added: 12, errors: [] })
    expect(requests).toBe(12)
    expect((await service.list()).entries.some(entry => entry.body === backlog[0]!.body)).toBe(true)
  })
})


describe('replying to public activity', () => {
  const parent = { uri: 'at://did:plc:parent/app.bsky.feed.post/first-reply', cid: 'bafyreiparent' }
  const root = { uri: 'at://did:plc:root/app.bsky.feed.post/original', cid: 'bafyreiroot' }

  test('uses the current parent CID and pins a nested Bluesky reply to its original root', () => {
    expect(blueskyReplyParent({ posts: [parent] }, parent.uri)).toEqual({ reply: { root: parent, parent } })
    const post = { ...parent, record: { reply: { root } } }
    expect(blueskyReplyParent({ posts: [post] }, parent.uri)).toEqual({ reply: { root, parent } })
    expect(() => blueskyReplyParent({ posts: [post] }, root.uri)).toThrow('could not find')
    expect(() => blueskyReplyParent({ posts: [{ ...post, viewer: { replyDisabled: true } }] }, parent.uri)).toThrow('disabled replies')
    expect(() => blueskyReplyParent({ posts: [{ ...post, record: { reply: {} } }] }, parent.uri)).toThrow('original conversation')
  })

  test('uses the receiving Mastodon instance’s status ID and retains unlisted visibility', () => {
    const status = { id: '4321', url: 'https://remote.social/@author/789', visibility: 'unlisted' }
    const notification = { id: '1234', type: 'mention', account: { acct: 'author@remote.social' }, status }
    const ref = { uri: '4321', cid: '4321' }
    expect(mastodonReplyParent(notification, '1234', status.url)).toEqual({ reply: { root: ref, parent: ref }, visibility: 'unlisted' })
    expect(() => mastodonReplyParent(notification, '1235', status.url)).toThrow('could not find')
    expect(() => mastodonReplyParent(notification, '1234', 'https://another.social/status/4321')).toThrow('could not find')
    expect(() => mastodonReplyParent({ ...notification, status: { ...status, visibility: 'private' } }, '1234', status.url)).toThrow('original public post')
  })

  test('keeps the original conversation and receiving account through queue failure and replay', async () => {
    const identity = await account()
    const otherIdentity = await account()
    const sent: Array<{ postId: number, identityId: number | null | undefined, content: PublishContent | undefined }> = []
    let lookups = 0
    const queue = new QueueService(new CrosspostService({
      bluesky: {
        async publishToPost(post, content, identityId) {
          sent.push({ postId: post.id, identityId, content })
          const ok = sent.length > 1
          await db.insertInto('post_targets').values({
            uuid: crypto.randomUUID(), post_id: post.id, provider: 'bluesky', social_identity_id: identityId,
            status: ok ? 'published' : 'failed', failure_reason: ok ? null : 'Fixture rejection',
          }).execute()
          return { provider: 'bluesky', ok, identityId: identityId ?? undefined }
        },
      },
    }))
    const service = new PublicInboxService(
      async (provider, identityId) => ({ items: provider === 'bluesky' && identityId === identity ? [mention('Original post')] : [] }),
      async (provider, identityId) => {
        expect(provider).toBe('bluesky')
        expect(identityId).toBe(identity)
        lookups++
        return { reply: { root, parent } }
      },
      queue,
    )
    await service.sync()
    const entry = (await service.list()).entries.find(item => item.body === 'Original post')!
    let postId: number | undefined
    try {
      const initial = await service.reply(entry.id, 'A public reply')
      expect(initial.status).toBe('queued')
      postId = initial.postId
      const expected = { reply: { root, parent }, replyTarget: `bluesky:${identity}` }
      expect(sent).toEqual([{ postId, identityId: identity, content: expected }])
      await expect(queue.update(postId, { text: 'Try another account', providers: [`bluesky:${otherIdentity}`] })).rejects.toThrow('account that received')
      expect(await service.reply(entry.id, ' A public reply ')).toEqual(initial)
      expect(sent).toHaveLength(1)
      await db.updateTable('post_targets').set({ social_identity_id: null }).where('post_id', '=', postId).execute()
      await expect(queue.publishNow(postId)).rejects.toThrow('account that received')
      expect(sent).toHaveLength(1)
      await db.updateTable('post_targets').set({ social_identity_id: identity }).where('post_id', '=', postId).execute()
      await queue.publishNow(postId)
      expect(sent[1]).toEqual(sent[0])
      expect(await service.reply(entry.id, 'A public reply')).toEqual({ postId, status: 'sent' })
      expect(sent).toHaveLength(2)
      expect(lookups).toBe(1)
      expect((await service.list()).entries.find(item => item.id === entry.id)?.read).toBe(true)
    }
    finally {
      if (postId) {
        await db.deleteFrom('post_submissions').where('receipt', 'like', `%"postId":${postId},%`).execute()
        await db.deleteFrom('post_targets').where('post_id', '=', postId).execute()
        await db.deleteFrom('posts').where('id', '=', postId).execute()
      }
    }
  })
})
