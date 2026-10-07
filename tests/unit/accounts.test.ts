import type { IdentityLike } from '../../app/Support/Social/accounts'
import type { CrosspostTargetResult, PublishContent, SocialProvider } from '../../app/Support/Social/types'
import { describe, expect, test } from 'bun:test'
import { CrosspostService } from '../../app/Services/Social/CrosspostService'
import { matchIdentity, pickDefaultIdentity, toPublicAccount } from '../../app/Support/Social/accounts'
import { PendingOAuthStates } from '../../app/Support/Social/oauth-state'
import { dedupeTargets, parseTarget, parseTargets, resolveTargets, targetKey, targetProviders } from '../../app/Support/Social/targets'

/**
 * Several accounts per network. Three rules carry the feature, and each is
 * pinned here without a database or a network:
 *
 * - a target names a network or one account on it, and de-dup is per account;
 * - a fresh login refreshes the row for the same account and adds a row for a
 *   different one (the decision `saveSession` makes through `matchIdentity`);
 * - publishing fans out to every selected account, with thread chains and
 *   results kept per account.
 */

const AVAILABLE = ['opentimes', 'bluesky', 'twitter', 'linkedin', 'instagram', 'threads', 'mastodon', 'blog']

describe('target specs', () => {
  test('a bare network name means the default account', () => {
    expect(parseTarget('bluesky', AVAILABLE)).toEqual({ provider: 'bluesky', identityId: null })
  })

  test('provider:id names one account', () => {
    expect(parseTarget('bluesky:12', AVAILABLE)).toEqual({ provider: 'bluesky', identityId: 12 })
    expect(parseTarget('  Mastodon:7 ', AVAILABLE)).toEqual({ provider: 'mastodon', identityId: 7 })
  })

  test('rejects a malformed account id instead of falling back to the default', () => {
    // Posting through a different account than the one picked is worse than
    // not posting there at all.
    for (const raw of ['bluesky:', 'bluesky:abc', 'bluesky:0', 'bluesky:-3', 'bluesky:1.5', 'bluesky:12:13'])
      expect(parseTarget(raw, AVAILABLE)).toBeNull()
  })

  test('rejects unknown or unavailable networks', () => {
    expect(parseTarget('myspace', AVAILABLE)).toBeNull()
    expect(parseTarget('myspace:3', AVAILABLE)).toBeNull()
    expect(parseTarget('facebook', AVAILABLE)).toBeNull()
    expect(parseTarget('', AVAILABLE)).toBeNull()
    expect(parseTarget(42, AVAILABLE)).toBeNull()
  })

  test('our own targets have no accounts, so an id on them is dropped', () => {
    expect(parseTarget('blog:4', AVAILABLE)).toEqual({ provider: 'blog', identityId: null })
    expect(parseTarget('opentimes:9', AVAILABLE)).toEqual({ provider: 'opentimes', identityId: null })
  })

  test('accepts parsed objects as well as strings', () => {
    expect(parseTarget({ provider: 'twitter', identityId: 3 }, AVAILABLE)).toEqual({ provider: 'twitter', identityId: 3 })
  })

  test('parses the comma-joined form field, dropping junk and exact duplicates', () => {
    expect(parseTargets('bluesky:1, bluesky:2,blog,nope,bluesky:1,twitter', AVAILABLE)).toEqual([
      { provider: 'bluesky', identityId: 1 },
      { provider: 'bluesky', identityId: 2 },
      { provider: 'blog', identityId: null },
      { provider: 'twitter', identityId: null },
    ])
  })

  test('campaign-style bare network arrays still parse', () => {
    expect(parseTargets(['bluesky', 'linkedin'], AVAILABLE).map(targetKey)).toEqual(['bluesky', 'linkedin'])
  })

  test('targetKey round-trips through parseTarget', () => {
    for (const raw of ['bluesky', 'bluesky:12', 'blog', 'mastodon:3'])
      expect(targetKey(parseTarget(raw, AVAILABLE)!)).toBe(raw)
  })
})

describe('same-network de-dup', () => {
  test('two accounts on one network are two targets', () => {
    const targets = dedupeTargets([
      { provider: 'bluesky', identityId: 1 },
      { provider: 'bluesky', identityId: 2 },
    ])
    expect(targets).toHaveLength(2)
    expect(targetProviders(targets)).toEqual(['bluesky'])
  })

  test('the same account twice is one target', () => {
    expect(dedupeTargets([
      { provider: 'twitter', identityId: 5 },
      { provider: 'twitter', identityId: 5 },
    ])).toEqual([{ provider: 'twitter', identityId: 5 }])
  })

  test('a bare target collapses into the explicit default account once resolved', () => {
    const resolved = resolveTargets(
      [{ provider: 'bluesky', identityId: null }, { provider: 'bluesky', identityId: 12 }],
      { bluesky: 12 },
    )
    expect(resolved).toEqual([{ provider: 'bluesky', identityId: 12 }])
  })

  test('a bare target alongside a non-default account keeps both', () => {
    const resolved = resolveTargets(
      [{ provider: 'bluesky', identityId: null }, { provider: 'bluesky', identityId: 13 }],
      { bluesky: 12 },
    )
    expect(resolved.map(targetKey)).toEqual(['bluesky:12', 'bluesky:13'])
  })

  test('a network with nothing connected stays bare, so the env fallback can still run', () => {
    expect(resolveTargets([{ provider: 'twitter', identityId: null }], { twitter: null }))
      .toEqual([{ provider: 'twitter', identityId: null }])
  })
})

function row(overrides: Partial<IdentityLike> & { id: number }): IdentityLike {
  return {
    provider: 'bluesky',
    handle: `user${overrides.id}.bsky.social`,
    external_id: `did:plc:${overrides.id}`,
    auth_status: 'connected',
    access_token: 'token',
    ...overrides,
  }
}

describe('saveSession: refresh the same account, add a different one', () => {
  const alice = row({ id: 1, handle: 'alice.bsky.social', external_id: 'did:plc:alice' })
  const bob = row({ id: 2, handle: 'bob.bsky.social', external_id: 'did:plc:bob' })

  test('reconnecting the same account updates its row', () => {
    expect(matchIdentity([alice, bob], { externalId: 'did:plc:bob', handle: 'bob.bsky.social' })).toBe(bob)
  })

  test('connecting a different account inserts a new row instead of overwriting', () => {
    // The old single-account code updated the newest row whatever the login
    // was — connecting a second account replaced the first.
    expect(matchIdentity([alice, bob], { externalId: 'did:plc:carol', handle: 'carol.bsky.social' })).toBeUndefined()
  })

  test('the stable id wins over a renamed handle', () => {
    expect(matchIdentity([alice], { externalId: 'did:plc:alice', handle: 'alice.example.com' })).toBe(alice)
  })

  test('a re-registered handle on a different id is a different account', () => {
    expect(matchIdentity([alice], { externalId: 'did:plc:someone-else', handle: 'alice.bsky.social' })).toBeUndefined()
  })

  test('a legacy row saved without an id is matched by handle, case and @ insensitive', () => {
    const legacy = row({ id: 3, handle: '@Alice.bsky.social', external_id: null })
    expect(matchIdentity([legacy], { externalId: 'did:plc:alice', handle: 'alice.bsky.social' })).toBe(legacy)
  })

  test('mastodon keys on @user@instance, so one instance can hold two accounts', () => {
    // external_id is the instance URL for every Mastodon row, so it cannot
    // tell accounts apart; the handle carries both user and instance.
    const social = row({ id: 4, provider: 'mastodon', handle: '@chris@mastodon.social', external_id: 'https://mastodon.social' })
    const work = row({ id: 5, provider: 'mastodon', handle: '@work@mastodon.social', external_id: 'https://mastodon.social' })
    expect(matchIdentity([social, work], { handle: '@work@mastodon.social' })).toBe(work)
    expect(matchIdentity([social, work], { handle: '@chris@hachyderm.io' })).toBeUndefined()
  })

  test('a disconnected account still matches, so reconnecting revives its row', () => {
    const revoked = row({ id: 6, auth_status: 'revoked', access_token: null, external_id: 'did:plc:gone' })
    expect(matchIdentity([revoked], { externalId: 'did:plc:gone' })).toBe(revoked)
  })
})

describe('default account', () => {
  test('prefers the newest usable account over a newer expired one', () => {
    const expired = row({ id: 1, auth_status: 'expired' })
    const live = row({ id: 2 })
    expect(pickDefaultIdentity([expired, live])).toBe(live)
  })

  test('never picks a disconnected account', () => {
    const revoked = row({ id: 1, auth_status: 'revoked', access_token: null })
    const expired = row({ id: 2, auth_status: 'expired' })
    expect(pickDefaultIdentity([revoked, expired])).toBe(expired)
    expect(pickDefaultIdentity([revoked])).toBeUndefined()
  })

  test('the public shape never carries tokens', () => {
    const account = toPublicAccount(row({ id: 9, access_token: 'secret', display_name: 'Nine' }), { isDefault: true })
    expect(JSON.stringify(account)).not.toContain('secret')
    expect(account).toMatchObject({ id: 9, handle: 'user9.bsky.social', displayName: 'Nine', connected: true, isDefault: true })
  })
})

describe('pending OAuth states', () => {
  test('two concurrent flows on one network both complete', () => {
    const pending = new PendingOAuthStates<{ codeVerifier: string }>()
    const first = pending.issue({ codeVerifier: 'one' })
    const second = pending.issue({ codeVerifier: 'two' })

    expect(pending.take(first)).toMatchObject({ found: true, value: { codeVerifier: 'one' } })
    expect(pending.take(second)).toMatchObject({ found: true, value: { codeVerifier: 'two' } })
  })

  test('a state is single-use', () => {
    const pending = new PendingOAuthStates()
    const state = pending.issue(true)
    pending.issue(true)
    expect(pending.take(state).found).toBe(true)
    expect(pending.take(state)).toMatchObject({ found: false, noneOutstanding: false })
  })

  test('expires after the TTL', () => {
    let clock = 0
    const pending = new PendingOAuthStates(1000, () => clock)
    const state = pending.issue(true)
    clock = 1001
    expect(pending.take(state)).toEqual({ found: false, noneOutstanding: true })
  })

  test('reports when nothing at all was outstanding', () => {
    expect(new PendingOAuthStates().take('anything')).toEqual({ found: false, noneOutstanding: true })
  })
})

/** A publisher that records what it was asked to publish, per account. */
function fakePublisher(provider: SocialProvider, defaultId: number | null) {
  const calls: Array<{ body: string, identityId: number | null | undefined, content?: PublishContent }> = []
  let sequence = 0
  return {
    calls,
    defaultIdentityId: async () => defaultId,
    publishToPost: async (post: { id: number, body: string }, content?: PublishContent, identityId?: number | null): Promise<CrosspostTargetResult> => {
      calls.push({ body: post.body, identityId, content })
      sequence += 1
      const account = identityId ?? defaultId ?? undefined
      return { provider, ok: true, uri: `at://${account}/${sequence}`, cid: `cid-${account}-${sequence}`, identityId: account }
    },
  }
}

describe('crossposting to several accounts on one network', () => {
  test('publishes once per selected account, through that account', async () => {
    const bsky = fakePublisher('bluesky', 1)
    const service = new CrosspostService({ bluesky: bsky })

    const results = await service.publishExisting({ id: 1, body: 'hello' }, ['bluesky:1', 'bluesky:2'])

    expect(bsky.calls.map(call => call.identityId)).toEqual([1, 2])
    expect(results.map(result => result.target)).toEqual(['bluesky:1', 'bluesky:2'])
  })

  test('a bare network plus its default account publishes once', async () => {
    const bsky = fakePublisher('bluesky', 1)
    const service = new CrosspostService({ bluesky: bsky })

    await service.publishExisting({ id: 1, body: 'hello' }, ['bluesky', 'bluesky:1'])
    expect(bsky.calls.map(call => call.identityId)).toEqual([1])
  })

  test('bare network names keep working (campaigns, old queued posts)', async () => {
    const bsky = fakePublisher('bluesky', 7)
    const blog = fakePublisher('blog', null)
    const service = new CrosspostService({ bluesky: bsky, blog })

    const results = await service.publishExisting({ id: 1, body: 'hello' }, ['bluesky', 'blog'])
    expect(bsky.calls.map(call => call.identityId)).toEqual([7])
    expect(blog.calls.map(call => call.identityId)).toEqual([null])
    expect(results.map(result => result.target)).toEqual(['bluesky:7', 'blog'])
  })

  test('a network variant applies to every account on that network', async () => {
    const bsky = fakePublisher('bluesky', 1)
    const service = new CrosspostService({ bluesky: bsky })

    await service.publishExisting({ id: 1, body: 'the long shared text' }, ['bluesky:1', 'bluesky:2'], { variants: { bluesky: 'short' } })
    expect(bsky.calls.map(call => call.body)).toEqual(['short', 'short'])
  })

  test('a failure on one account does not stop the other', async () => {
    const calls: Array<number | null | undefined> = []
    const service = new CrosspostService({
      bluesky: {
        defaultIdentityId: async () => 1,
        publishToPost: async (_post, _content, identityId) => {
          calls.push(identityId)
          return identityId === 1
            ? { provider: 'bluesky', ok: false, error: 'session expired' }
            : { provider: 'bluesky', ok: true, identityId: identityId ?? undefined }
        },
      },
    })

    const results = await service.publishExisting({ id: 1, body: 'hi' }, ['bluesky:1', 'bluesky:2'])
    expect(calls).toEqual([1, 2])
    // The failed result is still labelled with the account it was meant for.
    expect(results.map(result => [result.ok, result.identityId, result.target])).toEqual([
      [false, 1, 'bluesky:1'],
      [true, 2, 'bluesky:2'],
    ])
  })

  test('resolve drops unknown networks and malformed accounts', async () => {
    const service = new CrosspostService({ bluesky: fakePublisher('bluesky', null) })
    expect(await service.resolve(['bluesky', 'twitter:1', 'bluesky:nope'])).toEqual([{ provider: 'bluesky', identityId: null }])
  })
})
