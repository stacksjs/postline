/**
 * An inbox per account (#136): two connected Bluesky accounts each get their
 * own conversations, even with the same person, and a reply goes out from the
 * account the conversation belongs to.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { db } from '@stacksjs/database'
import { directMessages } from '../../app/Services/DirectMessageService'
import { getDmTransport } from '../../app/Services/Social/DirectMessages'
import { upsertIdentityRow } from '../../app/Services/Social/identities'

const database = db as any
const transport = getDmTransport('bluesky') as any
const original = { listConversations: transport.listConversations, listMessages: transport.listMessages, sendMessage: transport.sendMessage }

afterEach(async () => {
  Object.assign(transport, original)
  await database.deleteFrom('dm_messages').execute()
  await database.deleteFrom('dm_conversations').where('provider', '=', 'bluesky').execute()
  await database.deleteFrom('social_identities').where('provider', 'in', ['bluesky', 'threads']).execute()
})

async function connect(handle: string): Promise<number> {
  return Number((await upsertIdentityRow<any>('bluesky', { externalId: `did:plc:${handle}`, handle }, {
    handle, external_id: `did:plc:${handle}`, auth_status: 'connected', access_token: `a-${handle}`, refresh_token: `r-${handle}`,
  })).id)
}

describe('an inbox per account', () => {
  test('each account syncs its own conversations, and a reply uses the conversation\'s account', async () => {
    const work = await connect('work.bsky.social')
    const personal = await connect('me.bsky.social')
    const asked: Array<number | null | undefined> = []
    transport.listConversations = async (_limit: number, identityId?: number | null) => {
      asked.push(identityId)
      // The same conversation id on both accounts: the two talk to each other.
      return [{ remoteId: 'convo-shared', participants: [{ remoteId: 'did:plc:friend', handle: identityId === work ? 'me.bsky.social' : 'work.bsky.social' }], unreadCount: 1, lastMessageAt: new Date().toISOString(), lastMessageText: 'hello' }]
    }
    transport.listMessages = async () => []
    const sentAs: Array<number | null | undefined> = []
    transport.sendMessage = async (_remote: string, body: string, identityId?: number | null) => {
      sentAs.push(identityId)
      return { remoteId: `sent-${Date.now()}`, conversationRemoteId: 'convo-shared', direction: 'outgoing', authorRemoteId: 'did:plc:me', authorHandle: 'me.bsky.social', body, sentAt: new Date().toISOString() }
    }

    await directMessages.sync({ provider: 'bluesky' })
    expect(asked.sort()).toEqual([work, personal].sort())

    const forWork = await directMessages.list({ provider: 'bluesky', identityId: work })
    const forPersonal = await directMessages.list({ provider: 'bluesky', identityId: personal })
    expect(forWork.conversations).toHaveLength(1)
    expect(forPersonal.conversations).toHaveLength(1)
    expect(forWork.conversations[0]!.id).not.toBe(forPersonal.conversations[0]!.id)
    expect(forWork.providers.accounts.map((account: { id: number }) => account.id).sort()).toEqual([work, personal].sort())

    await directMessages.reply(forPersonal.conversations[0]!.id, 'from my own account')
    expect(sentAs).toEqual([personal])
  })

  test('explains only the connected networks it cannot read', async () => {
    // A network you never connected is not "connected for publishing" (#173).
    expect((await directMessages.providers()).unavailable.map(entry => entry.provider)).not.toContain('threads')
    await upsertIdentityRow<any>('threads', { externalId: 'threads-1', handle: 'me' }, {
      handle: 'me', external_id: 'threads-1', auth_status: 'connected', access_token: 'token',
    })
    expect((await directMessages.providers()).unavailable.map(entry => entry.provider)).toEqual(['threads'])
  })
})
