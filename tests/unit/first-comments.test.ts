import { afterEach, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { networkApps } from '../../app/Services/NetworkAppService'
import { crosspost } from '../../app/Services/Social/CrosspostService'
import { postFirstComments } from '../../app/Services/Social/PostFirstCommentService'
import { postQueue } from '../../app/Services/Social/QueueService'
import { upsertIdentityRow } from '../../app/Services/Social/identities'

const database = db as any
const realFetch = globalThis.fetch
const postIds: number[] = []
const identityIds: number[] = []
const organization = 'urn:li:organization:8542'

async function connect(provider: 'linkedin' | 'instagram', id: string, credentials: Record<string, string>) {
  const row = await upsertIdentityRow<any>(provider, { externalId: id }, {
    external_id: id, handle: id, auth_status: 'connected', ...credentials,
  })
  const identityId = Number(row.id)
  identityIds.push(identityId)
  return `${provider}:${identityId}`
}

afterEach(async () => {
  globalThis.fetch = realFetch
  for (const id of postIds.splice(0)) {
    await database.deleteFrom('post_targets').where('post_id', '=', id).execute()
    await database.deleteFrom('posts').where('id', '=', id).execute()
  }
  for (const id of identityIds.splice(0)) await database.deleteFrom('social_identities').where('id', '=', id).execute()
  await networkApps.clear('instagram')
})

function linkedInRequests(comment: () => Response) {
  const posts: Array<{ author: string, commentary: string }> = []
  const comments: Array<{ author: string | null, actor: string, object: string, message: { text: string } }> = []
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input))
    const body = JSON.parse(String(init?.body))
    if (url.pathname === '/rest/posts') {
      posts.push(body)
      return new Response(null, { status: 201, headers: { 'x-restli-id': `urn:li:share:${987 + posts.length}` } })
    }
    expect(url.pathname).toBe(`/rest/socialActions/${encodeURIComponent(body.object)}/comments`)
    comments.push({ ...body, author: new Headers(init?.headers).get('authorization') })
    return comment()
  }) as typeof fetch
  return { posts, comments }
}

test('instant publishing comments once on the lead LinkedIn post as the same organization', async () => {
  const account = await connect('linkedin', organization, { access_token: 'page-publisher' })
  // LinkedIn accepted the comment even though it omitted the ID.
  const { posts, comments } = linkedInRequests(() => new Response(null, { status: 201 }))
  const result = await crosspost.publishThread(['Lead copy', 'Second segment'], [account], {
    options: { firstComments: { linkedin: 'Links and references' } },
  })
  postIds.push(...result.postIds)

  expect(posts.map(post => post.author)).toEqual([organization, organization])
  expect(comments).toEqual([{
    author: 'Bearer page-publisher', actor: organization, object: 'urn:li:share:988',
    message: { text: 'Links and references' },
  }])
  expect(result.results[0]).toMatchObject({ ok: true, firstComment: { status: 'sent', remoteId: null } })
  expect(result.results[1]?.firstComment).toBeUndefined()
})

test('a refused scheduled first comment can be retried without publishing the parent again', async () => {
  const account = await connect('linkedin', organization, { access_token: 'page-publisher' })
  let denied = true
  const { posts, comments } = linkedInRequests(() => denied
    ? Response.json({ message: 'Forbidden' }, { status: 403 })
    : new Response(null, { status: 201, headers: { 'x-restli-id': '342' } }))
  const { postId } = await postQueue.save({
    text: 'Scheduled story',
    providers: [account],
    scheduledAt: new Date(Date.now() + 600_000).toISOString().slice(0, 19).replace('T', ' '),
    options: { firstComments: { linkedin: 'Scheduled footnote' } },
  })
  postIds.push(postId)
  const { results: [result] } = await postQueue.publishNow(postId)
  expect(result).toMatchObject({ ok: true, firstComment: { status: 'failed' } })
  const targetId = result!.targetId!
  const queue = (await postQueue.list()).find(item => item.id === postId)
  expect(queue).toMatchObject({ status: 'published', partial: false, providers: [{
    status: 'published', remoteUrl: expect.stringContaining('www.linkedin.com/feed/update/urn:li:share:988'),
    firstComment: { targetId, status: 'failed' },
  }] })

  denied = false
  const attempts = await Promise.all([postFirstComments.send(targetId, true), postFirstComments.send(targetId, true)])
  expect(attempts.filter(Boolean)).toEqual([{ status: 'sent', remoteId: '342' }])
  expect(posts).toHaveLength(1)
  expect(comments.map(comment => comment.message.text)).toEqual(['Scheduled footnote', 'Scheduled footnote'])
})

test('recovery sends an unattempted comment and leaves a lost acknowledgement for the owner to check', async () => {
  const account = await connect('linkedin', organization, { access_token: 'page-publisher' })
  const { comments } = linkedInRequests(() => { throw new Error('connection dropped') })
  const { postId, results: [result] } = await crosspost.publish('A live post', [account])
  postIds.push(postId)
  const targetId = result!.targetId!
  await database.updateTable('post_targets').set({ first_comment_body: 'Queued first comment', first_comment_status: 'pending' })
    .where('id', '=', targetId).execute()

  await postFirstComments.recoverPending()
  const target = await database.selectFrom('post_targets').select(['status', 'first_comment_status']).where('id', '=', targetId).executeTakeFirst()
  expect(target).toEqual({ status: 'published', first_comment_status: 'uncertain' })
  expect(await postFirstComments.send(targetId, true)).toBeUndefined()
  expect(comments).toHaveLength(1)
})

test('Instagram publishes with the Page token and comments with the Facebook User token', async () => {
  await networkApps.save('instagram', { clientId: 'meta-app-id', clientSecret: 'meta-app-secret', firstComments: true })
  const account = await connect('instagram', '841', { access_token: 'page-token', instagram_comments_access_token: 'user-token' })
  const writes: Array<[string, string | null, string | null]> = []
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input))
    const endpoint = url.pathname.split('/').at(-1)!
    if (init?.method === 'POST') writes.push([endpoint, new Headers(init.headers).get('authorization'), url.searchParams.get('message')])
    if (endpoint === 'media') return Response.json({ id: '782' })
    if (endpoint === '782') return Response.json({ status_code: 'FINISHED' })
    if (endpoint === 'media_publish') return Response.json({ id: '783' })
    if (endpoint === '783') return Response.json({ permalink: 'https://www.instagram.com/p/preview/' })
    expect(url.pathname).toEndWith('/783/comments')
    return Response.json({ id: '784' })
  }) as typeof fetch

  const { postId, results } = await crosspost.publish('Instagram caption', [account], {
    media: [{ url: 'https://images.example.org/publish.jpg' }],
    options: { firstComments: { instagram: 'Image credits' } },
  })
  postIds.push(postId)
  expect(results[0]).toMatchObject({ ok: true, firstComment: { status: 'sent', remoteId: '784' } })
  expect((await postQueue.list()).find(item => item.id === postId)?.providers[0]?.remoteUrl).toBe('https://www.instagram.com/p/preview/')
  expect(writes).toEqual([
    ['media', 'Bearer page-token', null],
    ['media_publish', 'Bearer page-token', null],
    ['comments', 'Bearer user-token', 'Image credits'],
  ])
})
