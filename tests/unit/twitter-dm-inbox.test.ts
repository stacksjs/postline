import { afterEach, beforeEach, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { directMessages } from '../../app/Services/DirectMessageService'
import { networkApps } from '../../app/Services/NetworkAppService'
import { upsertIdentityRow } from '../../app/Services/Social/identities'
import { twitterReadUsage } from '../../app/Services/Social/TwitterReadBudget'
import { twitter } from '../../app/Services/Social/TwitterService'

const previousLimit = Bun.env.TWITTER_DAILY_READ_BUDGET_USD
const realFetch = globalThis.fetch
const remote = '101-222'
let identityId: number

beforeEach(async () => {
  Bun.env.TWITTER_DAILY_READ_BUDGET_USD = '2'
  await db.unsafe('DELETE FROM twitter_read_usage')
  await networkApps.save('twitter', { clientId: 'dm-test-app', clientSecret: 'dm-test-secret', directMessages: true })
  const identity = await upsertIdentityRow('twitter', { externalId: '101', handle: 'owner' }, {
    provider: 'twitter', external_id: '101', handle: 'owner', access_token: 'consented-token',
    auth_status: 'connected', twitter_dm_consent: true, twitter_dm_state: null,
  })
  identityId = Number(identity.id)
})

afterEach(async () => {
  globalThis.fetch = realFetch
  if (previousLimit === undefined) delete Bun.env.TWITTER_DAILY_READ_BUDGET_USD
  else Bun.env.TWITTER_DAILY_READ_BUDGET_USD = previousLimit
  const threads = await db.unsafe('SELECT id FROM dm_conversations WHERE social_identity_id = ?', [identityId])
  for (const thread of threads) await db.unsafe('DELETE FROM dm_messages WHERE dm_conversation_id = ?', [thread.id])
  await db.unsafe('DELETE FROM dm_conversations WHERE social_identity_id = ?', [identityId])
  await db.unsafe('DELETE FROM social_identities WHERE id = ?', [identityId])
  await db.unsafe('DELETE FROM twitter_read_usage')
  await networkApps.clear('twitter')
})

function page(ids: string[], cursor?: string) {
  return Response.json({
    data: ids.map(id => ({ id, dm_conversation_id: remote, sender_id: '222', created_at: '2026-11-24T10:00:00Z', text: `Message ${id}` })),
    includes: { users: [{ id: '222', username: 'friend', name: 'Friend' }] },
    meta: { next_token: cursor },
  })
}

async function threadId(): Promise<number> {
  const inbox = await directMessages.list({ provider: 'twitter', identityId })
  return inbox.conversations[0]!.id
}

test('only offers consented X accounts and requests the DM scopes when enabled', async () => {
  const enabled = await twitter.prepareAuthorization()
  expect(new URL(enabled.url).searchParams.get('scope')?.split(' ')).toContain('dm.read')
  expect(enabled.requestedScopes).toContain('dm.write')
  expect((await directMessages.providers()).twitter.accounts).toEqual([{ id: identityId, handle: 'owner', older: false }])

  await db.unsafe('UPDATE social_identities SET twitter_dm_consent = 0 WHERE id = ?', [identityId])
  await expect(directMessages.syncTwitter(identityId, false)).rejects.toThrow('Reconnect this X account')
  expect((await directMessages.providers()).twitter.accounts).toEqual([])
  await networkApps.save('twitter', { clientId: 'dm-test-app', directMessages: false })
  expect((await twitter.prepareAuthorization()).requestedScopes).not.toContain('dm.read')
  await expect(directMessages.syncTwitter(identityId, false)).rejects.toThrow('Enable X API messages')
  expect((await twitterReadUsage()).estimatedUsd).toBe(0)
})

test('uses the scopes granted by X and handles an omitted unchanged scope list', async () => {
  let scope: string | undefined = 'tweet.read users.read dm.read'
  globalThis.fetch = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname
    if (path === '/2/oauth2/token') return Response.json({ access_token: 'new-token', scope })
    expect(path).toBe('/2/users/me')
    return Response.json({ data: { id: '101', username: 'owner' } })
  }) as typeof fetch

  const consent = await twitter.prepareAuthorization()
  const options = { codeVerifier: consent.codeVerifier, requestedScopes: consent.requestedScopes }
  await twitter.exchangeAuthorizationCode('first', options)
  expect((await directMessages.providers()).twitter.accounts).toEqual([])

  scope = undefined
  await twitter.exchangeAuthorizationCode('second', options)
  expect((await directMessages.providers()).twitter.accounts[0]?.id).toBe(identityId)
})

test('resumes recent pages after the budget stops a request and loads older history separately', async () => {
  const responses = [page(['104', '103'], 'archive'), page(['108', '107'], 'recent'), page(['106', '104'], 'already-seen'), page(['102'])]
  const fetched: Array<string | null> = []
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    expect(url.pathname).toBe('/2/dm_events')
    expect(url.searchParams.get('max_results')).toBe('25')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer consented-token')
    fetched.push(url.searchParams.get('pagination_token'))
    return responses.shift()!
  }) as typeof fetch

  expect((await directMessages.syncTwitter(identityId, false)).messages).toBe(2)
  expect((await directMessages.syncTwitter(identityId, false)).messages).toBe(2)
  expect((await twitterReadUsage()).estimatedUsd).toBe(0.06)
  Bun.env.TWITTER_DAILY_READ_BUDGET_USD = '0.55'
  await expect(directMessages.syncTwitter(identityId, false)).rejects.toMatchObject({ code: 'twitter_read_budget' })
  expect(fetched).toEqual([null, null])

  Bun.env.TWITTER_DAILY_READ_BUDGET_USD = '2'
  expect((await directMessages.syncTwitter(identityId, false)).messages).toBe(1)
  expect((await directMessages.syncTwitter(identityId, true)).messages).toBe(1)
  expect(fetched).toEqual([null, null, 'recent', 'archive'])
  expect((await twitterReadUsage()).estimatedUsd).toBe(0.11)
  const thread = await directMessages.thread(await threadId(), { markRead: false })
  expect(thread.conversation.lastMessagePreview).toBe('Message 108')
  expect(thread.conversation.participantName).toBe('Friend')
  expect(thread.messages.map((message: { remoteId: string }) => message.remoteId)).toEqual(['102', '103', '104', '106', '107', '108'])
  expect((await directMessages.providers()).twitter.accounts[0]?.older).toBe(false)
})

test('keeps automatic refreshes local and stores a reply only when X confirms it', async () => {
  const fetched: string[] = []
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    fetched.push(url.pathname)
    if (url.pathname === '/2/dm_events') return page(['104'])
    expect(init.body).toBe('{"text":"Thanks"}')
    return Response.json({ data: { dm_conversation_id: remote, dm_event_id: '105' } }, { status: 201 })
  }) as typeof fetch

  await directMessages.syncTwitter(identityId, false)
  const id = await threadId()
  await directMessages.sync({ provider: 'twitter' })
  await directMessages.sync({ conversationId: id })
  expect(fetched).toEqual(['/2/dm_events'])
  expect(await directMessages.reply(id, 'Thanks')).toMatchObject({ remoteId: '105', body: 'Thanks', direction: 'outgoing', status: 'sent' })
  expect(fetched).toEqual(['/2/dm_events', `/2/dm_conversations/${remote}/messages`])
  expect((await twitterReadUsage()).estimatedUsd).toBe(0.02)
})

test('recovers an expired history cursor without inserting newer messages twice', async () => {
  const responses = [
    page(['104', '103'], 'expired'),
    Response.json({ detail: 'The pagination_token is invalid or expired.' }, { status: 400 }),
    page(['104', '103'], 'replacement'),
    page(['102']),
  ]
  const fetched: Array<string | null> = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetched.push(new URL(String(input)).searchParams.get('pagination_token'))
    return responses.shift()!
  }) as typeof fetch

  expect((await directMessages.syncTwitter(identityId, false)).messages).toBe(2)
  await expect(directMessages.syncTwitter(identityId, true)).rejects.toThrow('X expired the message cursor')
  expect((await directMessages.syncTwitter(identityId, true)).messages).toBe(0)
  expect((await directMessages.syncTwitter(identityId, true)).messages).toBe(1)
  expect(fetched).toEqual([null, 'expired', null, 'replacement'])
})

test('serializes paid refreshes for the same account without billing a second page', async () => {
  const started = Promise.withResolvers<void>()
  const body = Promise.withResolvers<Response>()
  let calls = 0
  globalThis.fetch = Object.assign(async () => {
    calls++
    started.resolve()
    return body.promise
  }, { preconnect: realFetch.preconnect })

  const active = directMessages.syncTwitter(identityId, false)
  try {
    await Promise.race([started.promise, active.then(() => { throw new Error('The refresh ended before requesting a page') })])
    await expect(directMessages.syncTwitter(identityId, false)).rejects.toThrow('already refreshing')
    expect(calls).toBe(1)
    expect((await twitterReadUsage()).estimatedUsd).toBe(0.5)
  }
  finally {
    body.resolve(page(['104']))
    await active
  }
  expect((await twitterReadUsage()).estimatedUsd).toBe(0.02)
})
