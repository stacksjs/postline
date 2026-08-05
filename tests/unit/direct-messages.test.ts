import type { DmMessageCandidate } from '../../app/Support/Social/direct-messages'
import { describe, expect, test } from 'bun:test'
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
    expect([...DM_PROVIDERS]).toEqual(['bluesky', 'twitter', 'mastodon'])
    expect(isDmProvider('bluesky')).toBe(true)
    expect(isDmProvider('instagram')).toBe(false)
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
      event({ remoteId: '3', body: 'latest', direction: 'outgoing', authorRemoteId: 'me', authorHandle: 'postline', sentAt: '2026-08-05T12:00:00Z' }),
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

describe('mastodon body text', () => {
  test('status HTML is flattened to readable plain text', () => {
    expect(stripHtml('<p>Hey <a href="#">@you</a></p><p>Second line</p>')).toBe('Hey @you\n\nSecond line')
    expect(stripHtml('one<br>two')).toBe('one\ntwo')
    expect(stripHtml('&lt;script&gt; &amp; &quot;quotes&quot;')).toBe('<script> & "quotes"')
  })
})
