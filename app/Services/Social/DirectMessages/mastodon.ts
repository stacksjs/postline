/**
 * Mastodon DM transport — direct-visibility statuses.
 *
 * Mastodon has no messaging system. A "DM" is an ordinary status with
 * `visibility: direct`, and the conversations API is a view over those. Two
 * consequences shape this file:
 *
 * 1. There is no endpoint that lists the messages in a conversation. The
 *    conversation only carries its *last* status, so the thread is
 *    reconstructed from that status's `/context` (ancestors + descendants).
 * 2. Delivery is by mention, not by conversation id. A reply that does not
 *    name the other participants in its body reaches nobody, so `sendMessage`
 *    rebuilds the mention prefix rather than trusting the caller to.
 */

import type { DmConversationCandidate, DmMessageCandidate, DmTransport } from '../../../Support/Social/direct-messages'
import { stripHtml } from '../../../Support/Social/text'
import { mastodon } from '../MastodonService'

/** Mastodon's default status limit; instances may allow more, never less. */
const CHARACTER_LIMIT = 500

interface MastodonAccount {
  id: string
  acct?: string
  username?: string
  display_name?: string
  avatar?: string
}

interface MastodonStatus {
  id: string
  content?: string
  created_at?: string
  visibility?: string
  account?: MastodonAccount
}

interface MastodonConversation {
  id: string
  unread?: boolean
  accounts?: MastodonAccount[]
  last_status?: MastodonStatus | null
}

interface Identity {
  instance: string
  accessToken: string
  handle: string
}

async function request<T>(identity: Identity, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(new URL(path, identity.instance), {
    ...init,
    headers: {
      authorization: `Bearer ${identity.accessToken}`,
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

  if (!response.ok) {
    if (response.status === 403)
      throw new Error('Your Mastodon token cannot read direct messages. Recreate it with the read:statuses and write:statuses scopes, then reconnect on Accounts.')
    throw new Error(payload?.error_description || payload?.error || `Mastodon returned HTTP ${response.status}.`)
  }

  return payload as T
}

/**
 * `@user@host` → `user@host`; a bare `user` gains our own host.
 *
 * Mastodon writes local accounts as `user` and remote ones as `user@host`, so
 * comparing a status author against our own `@user@host` handle needs both
 * sides normalized first — otherwise every message we sent from our own
 * instance reads as incoming.
 */
export function canonicalAcct(value: string, instance: string): string {
  const acct = String(value || '').trim().replace(/^@/, '').toLowerCase()
  if (!acct) return ''
  return acct.includes('@') ? acct : `${acct}@${instance.replace(/^https?:\/\//, '')}`
}

function participantFrom(account: MastodonAccount, instance: string) {
  const acct = canonicalAcct(account.acct || account.username || '', instance)
  return {
    remoteId: String(account.id),
    handle: `@${acct}`,
    name: account.display_name || account.username || null,
    avatar: account.avatar || null,
  }
}

function messageFrom(status: MastodonStatus, conversationRemoteId: string, identity: Identity): DmMessageCandidate | null {
  if (!status?.id || !status.account) return null
  const acct = canonicalAcct(status.account.acct || status.account.username || '', identity.instance)
  const self = canonicalAcct(identity.handle, identity.instance)

  return {
    remoteId: String(status.id),
    conversationRemoteId,
    direction: acct === self ? 'outgoing' : 'incoming',
    authorRemoteId: String(status.account.id),
    authorHandle: `@${acct}`,
    authorName: status.account.display_name || status.account.username || null,
    body: stripHtml(String(status.content || '')),
    sentAt: status.created_at || new Date().toISOString(),
  }
}

export class MastodonDmTransport implements DmTransport {
  readonly provider = 'mastodon' as const
  readonly characterLimit = CHARACTER_LIMIT

  async listConversations(limit: number): Promise<DmConversationCandidate[]> {
    const identity = await mastodon.dmIdentity()
    const conversations = await request<MastodonConversation[]>(identity, `/api/v1/conversations?limit=${Math.min(Math.max(limit, 1), 40)}`)
    const self = canonicalAcct(identity.handle, identity.instance)

    return (conversations || []).flatMap((conversation) => {
      if (!conversation.id) return []
      const last = conversation.last_status
      const lastAcct = last?.account ? canonicalAcct(last.account.acct || last.account.username || '', identity.instance) : ''

      return [{
        remoteId: String(conversation.id),
        // Mastodon already excludes us from `accounts`, but a self-conversation
        // (a note to yourself) lists us, so filter anyway.
        participants: (conversation.accounts || [])
          .filter(account => canonicalAcct(account.acct || account.username || '', identity.instance) !== self)
          .map(account => participantFrom(account, identity.instance)),
        unreadCount: conversation.unread ? 1 : 0,
        lastMessageAt: last?.created_at || null,
        lastMessageText: last?.content ? stripHtml(last.content) : null,
        lastMessageOutgoing: Boolean(lastAcct && lastAcct === self),
      }]
    })
  }

  async listMessages(conversationRemoteId: string, limit: number): Promise<DmMessageCandidate[]> {
    const identity = await mastodon.dmIdentity()
    const conversation = await this.findConversation(identity, conversationRemoteId)
    const last = conversation.last_status
    if (!last?.id) return []

    const context = await request<{ ancestors?: MastodonStatus[], descendants?: MastodonStatus[] }>(identity, `/api/v1/statuses/${encodeURIComponent(last.id)}/context`)
    const thread = [...(context.ancestors || []), last, ...(context.descendants || [])]

    return thread
      // `/context` returns the whole reply tree; a thread that started public
      // and turned direct would otherwise leak its public half into the inbox.
      .filter(status => (status.visibility || 'direct') === 'direct')
      .flatMap(status => messageFrom(status, conversationRemoteId, identity) || [])
      .slice(-Math.max(limit, 1))
  }

  async sendMessage(conversationRemoteId: string, body: string): Promise<DmMessageCandidate> {
    const identity = await mastodon.dmIdentity()
    const conversation = await this.findConversation(identity, conversationRemoteId)
    const self = canonicalAcct(identity.handle, identity.instance)
    const mentions = (conversation.accounts || [])
      .map(account => canonicalAcct(account.acct || account.username || '', identity.instance))
      .filter(acct => acct && acct !== self)
      .map(acct => `@${acct}`)

    // Without the mentions the status is delivered to nobody, and without
    // `in_reply_to_id` it starts a second conversation next to this one.
    const status = mentions.length ? `${[...new Set(mentions)].join(' ')} ${body}` : body
    const sent = await request<MastodonStatus>(identity, '/api/v1/statuses', {
      method: 'POST',
      body: JSON.stringify({
        status,
        in_reply_to_id: conversation.last_status?.id,
        visibility: 'direct',
      }),
    })

    const candidate = messageFrom(sent, conversationRemoteId, identity)
    if (!candidate) throw new Error('Mastodon accepted the message but returned no status.')

    return { ...candidate, direction: 'outgoing' }
  }

  async markRead(conversationRemoteId: string): Promise<void> {
    const identity = await mastodon.dmIdentity()
    await request(identity, `/api/v1/conversations/${encodeURIComponent(conversationRemoteId)}/read`, { method: 'POST' })
  }

  /**
   * Mastodon exposes no "get one conversation" route, so the only way to reach
   * a conversation's participants and last status is to page the list and pick
   * it out. The list is capped at 40 by the API, which is also the sync depth.
   */
  private async findConversation(identity: Identity, conversationRemoteId: string): Promise<MastodonConversation> {
    const conversations = await request<MastodonConversation[]>(identity, '/api/v1/conversations?limit=40')
    const found = (conversations || []).find(conversation => String(conversation.id) === conversationRemoteId)
    if (!found) throw new Error('That Mastodon conversation is no longer in your inbox.')

    return found
  }
}
