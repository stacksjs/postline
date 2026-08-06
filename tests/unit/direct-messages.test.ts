import type { DmMessageCandidate } from '../../app/Support/Social/direct-messages'
import { describe, expect, test } from 'bun:test'
import { describeGraphError } from '../../app/Services/Social/DirectMessages/instagram'
import { canonicalAcct } from '../../app/Services/Social/DirectMessages/mastodon'
import { groupIntoConversations } from '../../app/Services/Social/DirectMessages/twitter'
import { DM_PROVIDERS, DM_UNAVAILABLE, isDmProvider } from '../../app/Support/Social/direct-messages'
import { stripHtml } from '../../app/Support/Social/text'

function event(overrides: Partial<DmMessageCandidate>): DmMessageCandidate {
  return {
    remoteId: 'event-1',
    conversationRemoteId: 'convo-1',
    direction: 'incoming',
    authorRemoteId: '99',
    authorHandle: 'someone',
    authorName: 'Someone',
    body: 'hello',
    sentAt: '2026-08-05T10:00:00Z',
    ...overrides,
  }
}

describe('dm provider registry', () => {
  test('only the networks with a working DM API are listed', () => {
    expect([...DM_PROVIDERS]).toEqual(['bluesky', 'twitter', 'mastodon', 'instagram'])
    expect(isDmProvider('bluesky')).toBe(true)
    expect(isDmProvider('instagram')).toBe(true)
    expect(isDmProvider('threads')).toBe(false)
    expect(isDmProvider(undefined)).toBe(false)
  })

  test('every unsupported network explains itself', () => {
    for (const [provider, reason] of Object.entries(DM_UNAVAILABLE)) {
      expect(DM_PROVIDERS).not.toContain(provider as never)
      expect(reason.length).toBeGreaterThan(20)
    }
  })
})

describe('x conversation grouping', () => {
  test('the newest event sets the preview and the rest only add participants', () => {
    const conversations = groupIntoConversations([
      event({ remoteId: '3', body: 'latest', direction: 'outgoing', authorRemoteId: 'me', authorHandle: 'opentimes', sentAt: '2026-08-05T12:00:00Z' }),
      event({ remoteId: '2', body: 'middle' }),
      event({ remoteId: '1', body: 'oldest' }),
    ], 10)

    expect(conversations).toHaveLength(1)
    expect(conversations[0].lastMessageText).toBe('latest')
    expect(conversations[0].lastMessageOutgoing).toBe(true)
    expect(conversations[0].lastMessageAt).toBe('2026-08-05T12:00:00Z')
    // The outgoing newest event names nobody, so the participant comes from
    // the older incoming ones — and is not duplicated across both of them.
    expect(conversations[0].participants).toEqual([{ remoteId: '99', handle: 'someone', name: 'Someone' }])
  })

  test('separate conversation ids stay separate, and the limit applies after grouping', () => {
    const conversations = groupIntoConversations([
      event({ remoteId: '1', conversationRemoteId: 'a' }),
      event({ remoteId: '2', conversationRemoteId: 'b' }),
      event({ remoteId: '3', conversationRemoteId: 'c' }),
    ], 2)

    expect(conversations.map(conversation => conversation.remoteId)).toEqual(['a', 'b'])
  })

  test('X reports no unread state, so grouping never invents one', () => {
    expect(groupIntoConversations([event({})], 10)[0].unreadCount).toBe(0)
  })
})

describe('mastodon account matching', () => {
  test('a local account is qualified with our own instance host', () => {
    expect(canonicalAcct('chris', 'https://mastodon.social')).toBe('chris@mastodon.social')
    expect(canonicalAcct('@chris', 'https://mastodon.social')).toBe('chris@mastodon.social')
  })

  test('a remote account keeps its own host', () => {
    expect(canonicalAcct('@someone@fosstodon.org', 'https://mastodon.social')).toBe('someone@fosstodon.org')
  })

  test('our stored handle and a local status author resolve to the same value', () => {
    const instance = 'https://mastodon.social'
    expect(canonicalAcct('@chris@mastodon.social', instance)).toBe(canonicalAcct('chris', instance))
  })

  test('a blank account never matches anything', () => {
    expect(canonicalAcct('', 'https://mastodon.social')).toBe('')
  })
})

describe('instagram graph errors', () => {
  test('the 24-hour rule is explained rather than surfaced as a code', () => {
    const outsideWindow = describeGraphError({ error: { code: 10, error_subcode: 2534022, message: 'This message is sent outside of allowed window.' } }, 400)
    expect(outsideWindow).toContain('24 hours')
    // Meta sends subcode 2534022 under more than one code, so the subcode
    // alone has to be enough to recognise it.
    expect(describeGraphError({ error: { error_subcode: 2534022 } }, 400)).toContain('24 hours')
  })

  test('a dead token and a missing permission give different instructions', () => {
    expect(describeGraphError({ error: { code: 190 } }, 400)).toContain('Reconnect')
    expect(describeGraphError({ error: { code: 200 } }, 403)).toContain('instagram_manage_messages')
  })

  test('rate limiting says to wait, not to reconnect', () => {
    const message = describeGraphError({ error: { code: 4 } }, 400)
    expect(message).toContain('rate limit')
    expect(message).not.toContain('Reconnect')
  })

  test('an unrecognised error keeps whatever Meta said', () => {
    expect(describeGraphError({ error: { code: 999, message: 'Something specific broke.' } }, 500)).toBe('Something specific broke.')
    expect(describeGraphError({}, 500)).toBe('Instagram returned HTTP 500.')
  })
})

describe('mastodon body text', () => {
  test('status HTML is flattened to readable plain text', () => {
    expect(stripHtml('<p>Hey <a href="#">@you</a></p><p>Second line</p>')).toBe('Hey @you\n\nSecond line')
    expect(stripHtml('one<br>two')).toBe('one\ntwo')
    expect(stripHtml('&lt;script&gt; &amp; &quot;quotes&quot;')).toBe('<script> & "quotes"')
  })
})
