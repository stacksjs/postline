/**
 * Instagram DM transport — Messenger Platform over the Facebook Graph API.
 *
 * Three things separate this from the other transports:
 *
 * 1. Sends are addressed to a *person*, not a conversation. `POST /messages`
 *    takes `recipient.id` — the other participant's IGSID — so every write
 *    first resolves the conversation to its participant.
 * 2. There is a 24-hour rule. Outside 24 hours of the user's last message,
 *    Instagram rejects the reply. That is a product rule rather than a bug, so
 *    it is translated into an explanation instead of a raw Graph error.
 * 3. It needs `instagram_manage_messages`, which Postline only started asking
 *    for when this landed. An account connected before then authenticates
 *    fine and then fails on the first DM call — hence the reconnect hint.
 */

import type { DmConversationCandidate, DmMessageCandidate, DmTransport } from '../../../Support/Social/direct-messages'
import { instagram } from '../InstagramService'

const GRAPH = 'https://graph.facebook.com'

/** Instagram's DM limit. */
const CHARACTER_LIMIT = 1000

interface GraphUser {
  id: string
  username?: string
  name?: string
}

interface GraphMessage {
  id: string
  created_time?: string
  message?: string
  from?: GraphUser
  to?: { data?: GraphUser[] }
}

interface GraphConversation {
  id: string
  updated_time?: string
  unread_count?: number
  participants?: { data?: GraphUser[] }
  messages?: { data?: GraphMessage[] }
}

interface Identity {
  accessToken: string
  igUserId: string
  handle: string
  graphVersion: string
}

/**
 * Turn a Graph error into something actionable.
 *
 * Meta returns the same HTTP status for "your token died", "you never had this
 * permission" and "you are outside the messaging window" — the useful signal
 * is in `code`/`error_subcode`, so it is read here rather than surfaced raw.
 */
export function describeGraphError(payload: any, status: number): string {
  const error = payload?.error || {}
  const code = Number(error.code || 0)
  const subcode = Number(error.error_subcode || 0)

  if (code === 10 || subcode === 2534022)
    return 'Instagram only allows replies within 24 hours of the person\'s last message. They need to message you again before you can answer.'
  if (code === 190 || status === 401)
    return 'Your Instagram connection expired. Reconnect it on the Accounts page.'
  if (code === 200 || code === 3 || status === 403)
    return 'This Instagram connection is missing DM permission. Reconnect it on Accounts so Postline can request instagram_manage_messages.'
  if (code === 4 || code === 613)
    return 'Instagram rate limit reached — try again in a few minutes.'

  return error.message || `Instagram returned HTTP ${status}.`
}

async function graph<T>(identity: Identity, path: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(`/${identity.graphVersion}${path}`, GRAPH)
  for (const [key, value] of Object.entries(init.query || {})) url.searchParams.set(key, value)
  url.searchParams.set('access_token', identity.accessToken)

  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  })

  const text = await response.text()
  let payload: any = {}
  try {
    payload = text ? JSON.parse(text) : {}
  }
  catch {}

  if (!response.ok) throw new Error(describeGraphError(payload, response.status))

  return payload as T
}

function participantFrom(user: GraphUser) {
  return {
    remoteId: String(user.id),
    handle: user.username ? `@${user.username}` : String(user.id),
    name: user.name || user.username || null,
    avatar: null,
  }
}

function messageFrom(message: GraphMessage, conversationRemoteId: string, identity: Identity): DmMessageCandidate | null {
  const senderId = String(message.from?.id || '')
  if (!message.id || !senderId) return null

  return {
    remoteId: String(message.id),
    conversationRemoteId,
    direction: senderId === identity.igUserId ? 'outgoing' : 'incoming',
    authorRemoteId: senderId,
    authorHandle: message.from?.username ? `@${message.from.username}` : senderId,
    authorName: message.from?.name || message.from?.username || null,
    body: String(message.message || ''),
    sentAt: message.created_time || new Date().toISOString(),
  }
}

export class InstagramDmTransport implements DmTransport {
  readonly provider = 'instagram' as const
  readonly characterLimit = CHARACTER_LIMIT

  async listConversations(limit: number): Promise<DmConversationCandidate[]> {
    const identity = await instagram.dmIdentity()
    const payload = await graph<{ data?: GraphConversation[] }>(identity, `/${identity.igUserId}/conversations`, {
      query: {
        // Without `platform=instagram` this returns the linked Facebook Page's
        // Messenger threads instead of the Instagram ones.
        platform: 'instagram',
        // One message is enough for the preview, and asking for it here saves
        // a round trip per conversation just to render the list.
        fields: 'id,updated_time,unread_count,participants,messages.limit(1){id,created_time,message,from}',
        limit: String(Math.min(Math.max(limit, 1), 50)),
      },
    })

    return (payload.data || []).flatMap((conversation) => {
      if (!conversation.id) return []
      const latest = conversation.messages?.data?.[0]

      return [{
        remoteId: String(conversation.id),
        participants: (conversation.participants?.data || [])
          .filter(user => String(user.id) !== identity.igUserId)
          .map(participantFrom),
        unreadCount: Number(conversation.unread_count || 0),
        lastMessageAt: latest?.created_time || conversation.updated_time || null,
        lastMessageText: latest?.message || null,
        lastMessageOutgoing: Boolean(latest?.from?.id && String(latest.from.id) === identity.igUserId),
      }]
    })
  }

  async listMessages(conversationRemoteId: string, limit: number): Promise<DmMessageCandidate[]> {
    const identity = await instagram.dmIdentity()
    const payload = await graph<GraphConversation>(identity, `/${encodeURIComponent(conversationRemoteId)}`, {
      query: { fields: `messages.limit(${Math.min(Math.max(limit, 1), 100)}){id,created_time,message,from,to}` },
    })

    // Graph returns newest first; the inbox reads oldest first.
    return (payload.messages?.data || [])
      .flatMap(message => messageFrom(message, conversationRemoteId, identity) || [])
      .reverse()
  }

  async sendMessage(conversationRemoteId: string, body: string): Promise<DmMessageCandidate> {
    const identity = await instagram.dmIdentity()
    const recipient = await this.recipientFor(identity, conversationRemoteId)
    const sent = await graph<{ message_id?: string, recipient_id?: string }>(identity, `/${identity.igUserId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ recipient: { id: recipient.remoteId }, message: { text: body } }),
    })

    if (!sent.message_id) throw new Error('Instagram accepted the message but returned no id.')

    return {
      remoteId: String(sent.message_id),
      conversationRemoteId,
      direction: 'outgoing',
      authorRemoteId: identity.igUserId,
      authorHandle: identity.handle,
      authorName: null,
      body,
      sentAt: new Date().toISOString(),
    }
  }

  async markRead(conversationRemoteId: string): Promise<void> {
    const identity = await instagram.dmIdentity()
    const recipient = await this.recipientFor(identity, conversationRemoteId)
    await graph(identity, `/${identity.igUserId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ recipient: { id: recipient.remoteId }, sender_action: 'mark_seen' }),
    })
  }

  /**
   * The person on the other end of a conversation.
   *
   * Writes are addressed to an IGSID, but Postline's transport contract is
   * conversation-keyed, so this resolves one to the other. A group thread has
   * no single recipient, which the Messenger API cannot express either — so it
   * is rejected here rather than silently answering only the first member.
   */
  private async recipientFor(identity: Identity, conversationRemoteId: string) {
    const payload = await graph<GraphConversation>(identity, `/${encodeURIComponent(conversationRemoteId)}`, {
      query: { fields: 'participants' },
    })

    const [recipient, ...rest] = (payload.participants?.data || [])
      .filter(user => String(user.id) !== identity.igUserId)
      .map(participantFrom)

    if (!recipient) throw new Error('That Instagram conversation has no one to reply to.')
    if (rest.length) throw new Error('Instagram group conversations cannot be answered from Postline yet.')

    return recipient
  }
}
