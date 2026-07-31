import { afterEach, describe, expect, test } from 'bun:test'
import { BlueskyDriver, parseAtUri } from '../../app/Services/Social/Drivers/BlueskyDriver'
import { LinkedInApiError, LinkedInDriver } from '../../app/Services/Social/Drivers/LinkedInDriver'
import { MastodonDriver } from '../../app/Services/Social/Drivers/MastodonDriver'
import { TwitterApiError, TwitterDriver } from '../../app/Services/Social/Drivers/TwitterDriver'
import { postPurge, PURGE_CONFIRMATION, PURGEABLE_PROVIDERS } from '../../app/Services/Social/PurgeService'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

interface Captured { url: string, method: string, body: any }

/** Capture every request and answer with `respond(url)`. */
function mockApi(captured: Captured[], respond: (url: string) => Response): void {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input)
    let body = init.body
    try { body = init.body ? JSON.parse(String(init.body)) : undefined }
    catch { /* non-JSON bodies (form data) stay as-is */ }
    captured.push({ url, method: init.method || 'GET', body })
    return respond(url)
  }) as typeof fetch
}

const blueskyIdentity = { handle: 'tester.bsky.social', did: 'did:plc:test', accessToken: 'jwt' }
const mastodonCreds = { instance: 'https://mastodon.social', accessToken: 'tok' }

describe('parseAtUri', () => {
  test('splits an AT-URI into repo, collection, and rkey', () => {
    expect(parseAtUri('at://did:plc:test/app.bsky.feed.post/abc123')).toEqual({
      repo: 'did:plc:test',
      collection: 'app.bsky.feed.post',
      rkey: 'abc123',
    })
  })

  test('rejects anything that is not a post URI', () => {
    expect(() => parseAtUri('https://bsky.app/profile/x/post/y')).toThrow(/not a Bluesky post URI/)
    expect(() => parseAtUri('')).toThrow(/not a Bluesky post URI/)
  })
})

describe('BlueskyDriver purge operations', () => {
  test('lists the account\'s own post records', async () => {
    const cap: Captured[] = []
    mockApi(cap, () => new Response(JSON.stringify({
      cursor: 'next-page',
      records: [
        { uri: 'at://did:plc:test/app.bsky.feed.post/one', cid: 'cid1', value: { text: 'hello', createdAt: '2026-01-01T00:00:00Z' } },
        { uri: 'at://did:plc:test/app.bsky.feed.post/two', cid: 'cid2', value: { text: 'world' } },
      ],
    }), { status: 200 }))

    const page = await new BlueskyDriver().listAuthoredPosts(blueskyIdentity)

    expect(cap[0]?.url).toContain('com.atproto.repo.listRecords')
    expect(cap[0]?.url).toContain('repo=did%3Aplc%3Atest')
    expect(cap[0]?.url).toContain('collection=app.bsky.feed.post')
    expect(page.cursor).toBe('next-page')
    expect(page.posts).toHaveLength(2)
    expect(page.posts[0]).toMatchObject({ uri: 'at://did:plc:test/app.bsky.feed.post/one', text: 'hello' })
    expect(page.posts[0]?.url).toBe('https://bsky.app/profile/tester.bsky.social/post/one')
  })

  test('deletes a post by its record key', async () => {
    const cap: Captured[] = []
    mockApi(cap, () => new Response('{}', { status: 200 }))

    await new BlueskyDriver().deletePost(blueskyIdentity, 'at://did:plc:test/app.bsky.feed.post/abc123')

    expect(cap[0]?.url).toContain('com.atproto.repo.deleteRecord')
    expect(cap[0]?.method).toBe('POST')
    expect(cap[0]?.body).toEqual({ repo: 'did:plc:test', collection: 'app.bsky.feed.post', rkey: 'abc123' })
  })

  test('refuses to delete without an access token', async () => {
    await expect(new BlueskyDriver().deletePost({ handle: 'x' }, 'at://a/b/c')).rejects.toThrow(/access token/i)
  })
})

describe('TwitterDriver purge operations', () => {
  test('lists the account\'s own tweets with pagination', async () => {
    const cap: Captured[] = []
    mockApi(cap, () => new Response(JSON.stringify({
      data: [{ id: '111', text: 'first', created_at: '2026-01-01T00:00:00Z' }],
      meta: { next_token: 'page2' },
    }), { status: 200 }))

    const page = await new TwitterDriver().listAuthoredPosts('AT', '77', { cursor: 'page1' })

    expect(cap[0]?.url).toContain('/2/users/77/tweets')
    expect(cap[0]?.url).toContain('pagination_token=page1')
    expect(page.cursor).toBe('page2')
    expect(page.posts[0]).toMatchObject({ uri: '111', cid: '111', text: 'first' })
  })

  test('deletes a tweet', async () => {
    const cap: Captured[] = []
    mockApi(cap, () => new Response(JSON.stringify({ data: { deleted: true } }), { status: 200 }))

    await new TwitterDriver().deletePost('AT', '111')

    expect(cap[0]?.url).toEndWith('/2/tweets/111')
    expect(cap[0]?.method).toBe('DELETE')
  })

  test('treats a "deleted: false" response as a failure', async () => {
    mockApi([], () => new Response(JSON.stringify({ data: { deleted: false } }), { status: 200 }))
    await expect(new TwitterDriver().deletePost('AT', '111')).rejects.toThrow(TwitterApiError)
  })
})

describe('MastodonDriver purge operations', () => {
  test('lists own statuses, excluding boosts, and cursors on the oldest id', async () => {
    const cap: Captured[] = []
    mockApi(cap, () => new Response(JSON.stringify([
      { id: '900', content: 'newer', url: 'https://mastodon.social/@glenn/900' },
      { id: '800', content: 'older', url: 'https://mastodon.social/@glenn/800' },
    ]), { status: 200 }))

    const page = await new MastodonDriver().listAuthoredPosts(mastodonCreds, '42')

    expect(cap[0]?.url).toContain('/api/v1/accounts/42/statuses')
    expect(cap[0]?.url).toContain('exclude_reblogs=true')
    expect(page.posts).toHaveLength(2)
    expect(page.cursor).toBe('800')
  })

  test('stops paginating when a page comes back empty', async () => {
    mockApi([], () => new Response('[]', { status: 200 }))
    const page = await new MastodonDriver().listAuthoredPosts(mastodonCreds, '42')
    expect(page.posts).toHaveLength(0)
    expect(page.cursor).toBeUndefined()
  })

  test('deletes a status by id', async () => {
    const cap: Captured[] = []
    mockApi(cap, () => new Response('{}', { status: 200 }))

    await new MastodonDriver().deletePost(mastodonCreds, '900')

    expect(cap[0]?.url).toEndWith('/api/v1/statuses/900')
    expect(cap[0]?.method).toBe('DELETE')
  })
})

describe('LinkedInDriver purge operations', () => {
  test('deletes a post by its URN', async () => {
    const cap: Captured[] = []
    mockApi(cap, () => new Response('', { status: 204 }))

    await new LinkedInDriver().deletePost('AT', 'urn:li:ugcPost:123')

    expect(cap[0]?.url).toEndWith('/rest/posts/urn%3Ali%3AugcPost%3A123')
    expect(cap[0]?.method).toBe('DELETE')
  })

  test('treats an already-deleted post as success', async () => {
    mockApi([], () => new Response('not found', { status: 404 }))
    await expect(new LinkedInDriver().deletePost('AT', 'urn:li:share:9')).resolves.toBeUndefined()
  })

  test('surfaces a real failure', async () => {
    mockApi([], () => new Response('nope', { status: 500 }))
    await expect(new LinkedInDriver().deletePost('AT', 'urn:li:share:9')).rejects.toThrow(LinkedInApiError)
  })

  test('lists authored posts with offset paging', async () => {
    const cap: Captured[] = []
    const elements = Array.from({ length: 50 }, (_, i) => ({ id: `urn:li:share:${i}`, commentary: `post ${i}` }))
    mockApi(cap, () => new Response(JSON.stringify({ elements }), { status: 200 }))

    const page = await new LinkedInDriver().listAuthoredPosts('AT', 'urn:li:person:abc')

    expect(cap[0]?.url).toContain('q=author')
    expect(cap[0]?.url).toContain('author=urn%3Ali%3Aperson%3Aabc')
    expect(page.posts).toHaveLength(50)
    // A full page means more may follow; the cursor is the next offset.
    expect(page.cursor).toBe('50')
  })

  test('stops paging on a short page', async () => {
    mockApi([], () => new Response(JSON.stringify({ elements: [{ id: 'urn:li:share:1' }] }), { status: 200 }))
    const page = await new LinkedInDriver().listAuthoredPosts('AT', 'urn:li:person:abc')
    expect(page.cursor).toBeUndefined()
  })

  test('explains the missing permission when LinkedIn refuses to list', async () => {
    mockApi([], () => new Response('{"status":403}', { status: 403 }))
    await expect(new LinkedInDriver().listAuthoredPosts('AT', 'urn:li:person:abc'))
      .rejects.toThrow(/r_member_social/)
  })
})

describe('purge safeguards', () => {
  test('only providers with a delete API are purgeable', () => {
    expect(PURGEABLE_PROVIDERS).toEqual(['bluesky', 'twitter', 'mastodon', 'linkedin'])
    expect(PURGEABLE_PROVIDERS).not.toContain('instagram')
    expect(PURGEABLE_PROVIDERS).not.toContain('threads')
  })

  test('refuses to execute without the exact confirmation phrase', async () => {
    for (const confirmation of ['', 'delete all posts', 'DELETE ALL POST', 'yes']) {
      await expect(postPurge.purge({ scope: 'all', confirmation })).rejects.toThrow(PURGE_CONFIRMATION)
    }
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
})
