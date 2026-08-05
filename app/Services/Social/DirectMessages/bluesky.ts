/**
 * Bluesky DM transport — `chat.bsky.convo.*`.
 *
 * Two things make this different from every other XRPC call in the app:
 *
 * 1. Chat lives on a separate service (`api.bsky.chat`), reached by asking
 *    your own PDS to proxy for it via the `atproto-proxy` header. Calling
 *    `api.bsky.chat` directly with a PDS-issued token does not work.
 * 2. It needs a token whose scope includes DM access. App passwords are
 *    created without it by default, and the resulting failure is an opaque
 *    `Bad token scope`, so that case is translated below.
 */

import type { SocialIdentityCredentials } from '../../../Support/Social/types'
import type { DmConversationCandidate, DmMessageCandidate, DmTransport } from '../../../Support/Social/direct-messages'
import { bluesky } from '../BlueskyService'
import { BlueskyApiError } from '../Drivers/BlueskyDriver'

/** The PDS proxies chat calls to this service on our behalf. */
const CHAT_PROXY = 'did:web:api.bsky.chat#bsky_chat'
const SERVICE = 'https://bsky.social'

/** Bluesky's DM limit — shorter than the 300-character post limit. */
const CHARACTER_LIMIT = 1000

interface ConvoMember {
  did: string
  handle: string
  displayName?: string
  avatar?: string
}

interface ConvoMessage {
  id: string
  text?: string
  sentAt: string
  sender?: { did: string }
}

interface Convo {
  id: string
  members?: ConvoMember[]
  lastMessage?: ConvoMessage & { $type?: string }
  unreadCount?: number
}

async function chat<T>(credentials: SocialIdentityCredentials, method: string, init: { body?: unknown, query?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(`/xrpc/${method}`, SERVICE)
  for (const [key, value] of Object.entries(init.query || {})) url.searchParams.set(key, value)

  const response = await fetch(url, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: {
      'atproto-proxy': CHAT_PROXY,
      'authorization': `Bearer ${credentials.accessToken}`,
      'accept': 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  })

  const text = await response.text()
  if (!response.ok) {
    let message = `Bluesky chat returned HTTP ${response.status}.`
    try {
      const parsed = JSON.parse(text)
      // The scope failure is the one people actually hit, and its raw wording
      // ("Bad token scope") gives no hint at the fix.
      if (/bad token scope|invalidtoken/i.test(`${parsed?.error} ${parsed?.message}`))
        message = 'This Bluesky app password cannot read DMs. Create a new app password with "Allow access to your direct messages" enabled, then reconnect on Accounts.'
      else message = parsed?.message || parsed?.error || message
    }
    catch {}

    // Thrown as a BlueskyApiError so BlueskyService.withSession recognises an
    // expired access JWT and refreshes rather than surfacing it.
    throw new BlueskyApiError(message, response.status, text)
  }

  return text ? JSON.parse(text) as T : {} as T
}

function messageFrom(convoId: string, message: ConvoMessage, members: ConvoMember[], selfDid: string): DmMessageCandidate | null {
  const senderDid = String(message.sender?.did || '')
  if (!message.id || !senderDid) return null
  const author = members.find(member => member.did === senderDid)

  return {
    remoteId: String(message.id),
    conversationRemoteId: convoId,
    direction: senderDid === selfDid ? 'outgoing' : 'incoming',
    authorRemoteId: senderDid,
    authorHandle: author?.handle || senderDid,
    authorName: author?.displayName || null,
    body: String(message.text || ''),
    sentAt: message.sentAt || new Date().toISOString(),
  }
}

/**
 * Members of a convo, cached for the length of one sync.
 *
 * `chat.bsky.convo.getMessages` identifies senders by DID only, so resolving a
 * handle means going back to `getConvo`. Without the cache, paging one thread
 * would re-fetch the same two members for every message.
 */
async function convoMembers(credentials: SocialIdentityCredentials, convoId: string, cache: Map<string, ConvoMember[]>): Promise<ConvoMember[]> {
  const cached = cache.get(convoId)
  if (cached) return cached

  const payload = await chat<{ convo?: Convo }>(credentials, 'chat.bsky.convo.getConvo', { query: { convoId } })
  const members = payload.convo?.members || []
  cache.set(convoId, members)
  return members
}

export class BlueskyDmTransport implements DmTransport {
  readonly provider = 'bluesky' as const
  readonly characterLimit = CHARACTER_LIMIT

  private members = new Map<string, ConvoMember[]>()

  async listConversations(limit: number): Promise<DmConversationCandidate[]> {
    return await bluesky.withSession(async (credentials) => {
      const payload = await chat<{ convos?: Convo[] }>(credentials, 'chat.bsky.convo.listConvos', {
        query: { limit: String(Math.min(Math.max(limit, 1), 100)) },
      })
      const selfDid = String(credentials.did || '')

      return (payload.convos || []).flatMap((convo) => {
        if (!convo.id) return []
        const members = convo.members || []
        this.members.set(String(convo.id), members)

        return [{
          remoteId: String(convo.id),
          participants: members
            .filter(member => member.did !== selfDid)
            .map(member => ({
              remoteId: member.did,
              handle: member.handle,
              name: member.displayName || null,
              avatar: member.avatar || null,
            })),
          unreadCount: Number(convo.unreadCount || 0),
          lastMessageAt: convo.lastMessage?.sentAt || null,
          lastMessageText: convo.lastMessage?.text || null,
          lastMessageOutgoing: Boolean(convo.lastMessage?.sender?.did && convo.lastMessage.sender.did === selfDid),
        }]
      })
    })
  }

  async listMessages(conversationRemoteId: string, limit: number): Promise<DmMessageCandidate[]> {
    return await bluesky.withSession(async (credentials) => {
      const payload = await chat<{ messages?: ConvoMessage[] }>(credentials, 'chat.bsky.convo.getMessages', {
        query: { convoId: conversationRemoteId, limit: String(Math.min(Math.max(limit, 1), 100)) },
      })
      const members = await convoMembers(credentials, conversationRemoteId, this.members)
      const selfDid = String(credentials.did || '')

      // The API returns newest first; the inbox reads oldest first.
      return (payload.messages || [])
        .flatMap(message => messageFrom(conversationRemoteId, message, members, selfDid) || [])
        .reverse()
    })
  }

  async sendMessage(conversationRemoteId: string, body: string): Promise<DmMessageCandidate> {
    return await bluesky.withSession(async (credentials) => {
      const sent = await chat<ConvoMessage>(credentials, 'chat.bsky.convo.sendMessage', {
        body: { convoId: conversationRemoteId, message: { text: body } },
      })
      const members = await convoMembers(credentials, conversationRemoteId, this.members)
      const selfDid = String(credentials.did || '')
      const candidate = messageFrom(conversationRemoteId, { ...sent, sender: sent.sender || { did: selfDid } }, members, selfDid)
      if (!candidate) throw new Error('Bluesky accepted the message but returned no id.')

      return candidate
    })
  }

  async markRead(conversationRemoteId: string): Promise<void> {
    await bluesky.withSession(credentials =>
      chat(credentials, 'chat.bsky.convo.updateRead', { body: { convoId: conversationRemoteId } }),
    )
  }
}
