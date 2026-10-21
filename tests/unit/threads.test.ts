import type { CrosspostTargetResult, PublishContent } from '../../app/Support/Social/types'
import type { ThreadChain } from '../../app/Support/Social/threads'
import { describe, expect, test } from 'bun:test'
import { advanceChain, threadSegmentContent } from '../../app/Support/Social/threads'

/**
 * Thread chaining, pinned without a database or a network.
 *
 * `CrosspostService.publishThread` interleaves these rules with a `posts`
 * insert per segment, so until they were lifted out they could not be
 * exercised at all — which is why a comment in tests/unit/accounts.test.ts
 * claimed thread chains were covered there while nothing called the method.
 *
 * Three behaviours carry the feature: a chain that advances without losing its
 * root, a provider with no cid publishing independently instead, and chains
 * that never cross between accounts.
 */

/** The shape Bluesky returns: an AT-protocol uri plus a content hash. */
function chained(uri: string, cid: string): CrosspostTargetResult {
  return { provider: 'bluesky', ok: true, uri, cid }
}

/** What every other network returns: a link, and nothing to reply to. */
function unchained(provider: CrosspostTargetResult['provider'], uri?: string): CrosspostTargetResult {
  return { provider, ok: true, url: 'https://example.test/p/1', uri }
}

describe('advanceChain', () => {
  test('the first chained segment becomes both root and parent', () => {
    expect(advanceChain(undefined, chained('at://1', 'cid1'))).toEqual({
      root: { uri: 'at://1', cid: 'cid1' },
      parent: { uri: 'at://1', cid: 'cid1' },
    })
  })

  test('later segments move parent and leave root alone', () => {
    let chain = advanceChain(undefined, chained('at://1', 'cid1'))
    chain = advanceChain(chain, chained('at://2', 'cid2'))
    chain = advanceChain(chain, chained('at://3', 'cid3'))

    // Segment 3 replies to segment 2, and the whole thread still hangs off 1.
    expect(chain).toEqual({
      root: { uri: 'at://1', cid: 'cid1' },
      parent: { uri: 'at://3', cid: 'cid3' },
    })
  })

  test('a result with no cid never starts a chain', () => {
    expect(advanceChain(undefined, unchained('linkedin'))).toBeUndefined()
    // A uri alone is not enough: there is no content hash to reply to.
    expect(advanceChain(undefined, unchained('mastodon', 'https://m.test/1'))).toBeUndefined()
  })

  test('a failed segment does not become the parent of the next one', () => {
    const chain = advanceChain(undefined, chained('at://1', 'cid1'))
    const after = advanceChain(chain, { provider: 'bluesky', ok: false, uri: 'at://2', cid: 'cid2' })

    // Otherwise segment 3 would reply to a post that was never created.
    expect(after).toEqual(chain!)
  })

  test('an existing chain survives a segment that cannot be chained', () => {
    const chain = advanceChain(undefined, chained('at://1', 'cid1'))
    expect(advanceChain(chain, unchained('bluesky'))).toEqual(chain!)
  })

  test('chaining is decided by the cid, not by a list of providers', () => {
    // A network that gains native threading chains as soon as its driver
    // returns a cid — nothing here has to be updated to let it.
    const result = { provider: 'threads' as const, ok: true, uri: 'th://9', cid: 'cid9' }
    expect(advanceChain(undefined, result)).toEqual({
      root: { uri: 'th://9', cid: 'cid9' },
      parent: { uri: 'th://9', cid: 'cid9' },
    })
  })
})

describe('chains stay per account', () => {
  test('two accounts on one network thread independently', () => {
    const chains = new Map<string, ThreadChain>()

    // Segment 1 publishes to both accounts, then segment 2 to both.
    const advance = (key: string, result: CrosspostTargetResult) => {
      const next = advanceChain(chains.get(key), result)
      if (next) chains.set(key, next)
    }
    advance('bluesky:1', chained('at://a1', 'cidA1'))
    advance('bluesky:2', chained('at://b1', 'cidB1'))
    advance('bluesky:1', chained('at://a2', 'cidA2'))
    advance('bluesky:2', chained('at://b2', 'cidB2'))

    // Account 2's segment 2 must reply to account 2's segment 1, never to
    // account 1's — the posts live on different accounts' timelines.
    expect(chains.get('bluesky:1')).toEqual({
      root: { uri: 'at://a1', cid: 'cidA1' },
      parent: { uri: 'at://a2', cid: 'cidA2' },
    })
    expect(chains.get('bluesky:2')).toEqual({
      root: { uri: 'at://b1', cid: 'cidB1' },
      parent: { uri: 'at://b2', cid: 'cidB2' },
    })
  })

  test('one account failing leaves the other account\'s thread intact', () => {
    const chains = new Map<string, ThreadChain>()
    chains.set('bluesky:1', advanceChain(undefined, chained('at://a1', 'cidA1'))!)

    const failed = advanceChain(chains.get('bluesky:2'), { provider: 'bluesky', ok: false, error: 'session expired' })
    expect(failed).toBeUndefined()
    expect(chains.get('bluesky:1')).toBeDefined()
  })
})

describe('threadSegmentContent', () => {
  const content: PublishContent = {
    title: 'A title',
    external: { uri: 'https://example.test', title: 'Card' },
    media: [{ url: 'https://example.test/i.png' }],
    variants: { bluesky: 'the short version' },
  }

  test('the opening segment carries the content, minus variants', () => {
    const first = threadSegmentContent(0, content, undefined)

    expect(first?.external).toEqual(content.external!)
    expect(first?.media).toEqual(content.media!)
    expect(first?.title).toBe('A title')
    // Stripped on purpose: an override cannot say whether it replaces the
    // first segment or the whole chain, so a thread publishes its segments.
    expect(first?.variants).toBeUndefined()
  })

  test('the opening segment of a bare thread carries nothing', () => {
    expect(threadSegmentContent(0, undefined, undefined)).toBeUndefined()
  })

  test('later segments carry only their reply refs', () => {
    const chain: ThreadChain = {
      root: { uri: 'at://1', cid: 'cid1' },
      parent: { uri: 'at://2', cid: 'cid2' },
    }
    const second = threadSegmentContent(1, content, chain)

    expect(second).toEqual({ reply: chain })
    // The link card belongs on the post that opens the thread, not on each one.
    expect(second?.external).toBeUndefined()
    expect(second?.media).toBeUndefined()
  })

  test('later segments on an unchainable provider publish independently', () => {
    expect(threadSegmentContent(1, content, undefined)).toBeUndefined()
    expect(threadSegmentContent(2, undefined, undefined)).toBeUndefined()
  })

  test('the original content object is never mutated', () => {
    threadSegmentContent(0, content, undefined)
    expect(content.variants).toEqual({ bluesky: 'the short version' })
  })
})
