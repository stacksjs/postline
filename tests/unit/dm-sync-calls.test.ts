/**
 * A sync with nothing new makes one call per network, and stored messages
 * are found with one query, not one per message (#108).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { directMessages } from '../../app/Services/DirectMessageService'
import { getDmTransport } from '../../app/Services/Social/DirectMessages'

const transport = getDmTransport('mastodon') as any
const original = { listConversations: transport.listConversations, listMessages: transport.listMessages }

afterEach(() => {
  transport.listConversations = original.listConversations
  transport.listMessages = original.listMessages
})

describe('direct message sync', () => {
  test('an unchanged conversation is not fetched again', async () => {
    const remote = `sync-${crypto.randomUUID()}`
    let lastMessageAt = '2026-11-01T10:00:00Z'
    let messageCalls = 0
    transport.listConversations = async () => [{ remoteId: remote, participants: [{ remoteId: 'p', handle: 'friend@example.social' }], unreadCount: 0, lastMessageAt, lastMessageText: 'hi' }]
    transport.listMessages = async () => {
      messageCalls++
      return [{ remoteId: `${remote}-1`, conversationRemoteId: remote, direction: 'incoming', authorRemoteId: 'p', authorHandle: 'friend@example.social', body: 'hi', sentAt: lastMessageAt }]
    }

    const first = await directMessages.sync({ provider: 'mastodon' })
    expect(messageCalls).toBe(1)
    expect(first.messages).toBe(1)

    // Nothing new: the list call only.
    const second = await directMessages.sync({ provider: 'mastodon' })
    expect(messageCalls).toBe(1)
    expect(second.messages).toBe(0)

    // A newer message: fetched, and the stored one is not stored twice.
    lastMessageAt = '2026-11-01T11:00:00Z'
    const third = await directMessages.sync({ provider: 'mastodon' })
    expect(messageCalls).toBe(2)
    expect(third.messages).toBe(0)
  })
})
