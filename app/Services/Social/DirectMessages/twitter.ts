/**
 * X (Twitter) DM transport — `/2/dm_events` and `/2/dm_conversations`.
 *
 * X has no "list my conversations" endpoint. It has a flat, reverse-chronological
 * stream of DM events across every thread, each tagged with a
 * `dm_conversation_id`, so conversations are derived by grouping that stream —
 * which also means the conversation list is only as complete as the page of
 * events fetched. That is why `listConversations` pulls the maximum page size
 * rather than the caller's limit, and applies the limit after grouping.
 *
 * Needs the `dm.read` and `dm.write` OAuth2 scopes. A connection made before
 * those were requested returns 403 and has to be reconnected.
 */

import type { DmConversationCandidate, DmMessageCandidate, DmTransport } from '../../../Support/Social/direct-messages'
import { twitter } from '../TwitterService'

const API = 'https://api.twitter.com'

/** Largest page `/2/dm_events` will return. */
const MAX_PAGE = 100

/** DM limit for the standard API tier. */
const CHARACTER_LIMIT = 10_000

const EVENT_FIELDS = 'id,text,created_at,dm_conversation_id,sender_id,event_type'
const USER_FIELDS = 'name,username,profile_image_url'

interface DmEvent {
  id: string
  text?: string
  created_at?: string
  dm_conversation_id?: string
  sender_id?: string
  event_type?: string
}

interface DmUser {
  id: string
  name?: string
  username?: string
  profile_image_url?: string
}

interface DmEventPage {
  data?: DmEvent[]
  includes?: { users?: DmUser[] }
}

async function request<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(new URL(path, API), {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
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
    if (response.status === 403) {
      throw new Error('X rejected the DM request. Reconnect X on Accounts so Postline can request the dm.read and dm.write scopes.')
    }
    throw new Error(payload?.detail || payload?.title || payload?.errors?.[0]?.message || `X returned HTTP ${response.status}.`)
  }

  return payload as T
}

/** Only message events carry a body; joins/leaves are noise in an inbox. */
function isMessage(event: DmEvent): boolean {
  return (event.event_type || 'MessageCreate') === 'MessageCreate'
}

function toCandidates(page: DmEventPage, selfId: string): DmMessageCandidate[] {
  const users = new Map((page.includes?.users || []).map(user => [String(user.id), user]))

  return (page.data || []).flatMap((event) => {
    const conversationId = String(event.dm_conversation_id || '')
    const senderId = String(event.sender_id || '')
    if (!event.id || !conversationId || !senderId || !isMessage(event)) return []
    const user = users.get(senderId)

    return [{
      remoteId: String(event.id),
      conversationRemoteId: conversationId,
      direction: senderId === selfId ? 'outgoing' as const : 'incoming' as const,
      authorRemoteId: senderId,
      authorHandle: user?.username || senderId,
      authorName: user?.name || null,
      body: String(event.text || ''),
      sentAt: event.created_at || new Date().toISOString(),
    }]
  })
}

/**
 * Fold a reverse-chronological event stream into conversations.
 *
 * Events arrive newest first, so the first event seen for a conversation is
 * its most recent one and sets the preview; later ones only contribute
 * participants. Exported because this grouping — not the HTTP call — is where
 * the interesting behaviour lives.
 */
export function groupIntoConversations(events: DmMessageCandidate[], limit: number): DmConversationCandidate[] {
  const conversations = new Map<string, DmConversationCandidate>()

  for (const event of events) {
    const existing = conversations.get(event.conversationRemoteId)
    if (!existing) {
      conversations.set(event.conversationRemoteId, {
        remoteId: event.conversationRemoteId,
        participants: event.direction === 'incoming'
          ? [{ remoteId: event.authorRemoteId, handle: event.authorHandle, name: event.authorName }]
          : [],
        // X reports no unread state, so Postline tracks it locally.
        unreadCount: 0,
        lastMessageAt: event.sentAt,
        lastMessageText: event.body,
        lastMessageOutgoing: event.direction === 'outgoing',
      })
      continue
    }

    if (event.direction === 'incoming' && !existing.participants.some(person => person.remoteId === event.authorRemoteId)) {
      existing.participants.push({ remoteId: event.authorRemoteId, handle: event.authorHandle, name: event.authorName })
    }
  }

  return [...conversations.values()].slice(0, Math.max(limit, 1))
}

export class TwitterDmTransport implements DmTransport {
  readonly provider = 'twitter' as const
  readonly characterLimit = CHARACTER_LIMIT

  async listConversations(limit: number): Promise<DmConversationCandidate[]> {
    const identity = await twitter.dmIdentity()
    const query = new URLSearchParams({
      'max_results': String(MAX_PAGE),
      'dm_event.fields': EVENT_FIELDS,
      'expansions': 'sender_id',
      'user.fields': USER_FIELDS,
    })
    const page = await request<DmEventPage>(identity.accessToken, `/2/dm_events?${query}`)

    return groupIntoConversations(toCandidates(page, identity.userId), limit)
  }

  async listMessages(conversationRemoteId: string, limit: number): Promise<DmMessageCandidate[]> {
    const identity = await twitter.dmIdentity()
    const query = new URLSearchParams({
      'max_results': String(Math.min(Math.max(limit, 1), MAX_PAGE)),
      'dm_event.fields': EVENT_FIELDS,
      'expansions': 'sender_id',
      'user.fields': USER_FIELDS,
    })
    const page = await request<DmEventPage>(identity.accessToken, `/2/dm_conversations/${encodeURIComponent(conversationRemoteId)}/dm_events?${query}`)

    return toCandidates(page, identity.userId).reverse()
  }

  async sendMessage(conversationRemoteId: string, body: string): Promise<DmMessageCandidate> {
    const identity = await twitter.dmIdentity()
    const sent = await request<{ data?: { dm_event_id?: string, dm_conversation_id?: string } }>(
      identity.accessToken,
      `/2/dm_conversations/${encodeURIComponent(conversationRemoteId)}/messages`,
      { method: 'POST', body: JSON.stringify({ text: body }) },
    )

    if (!sent.data?.dm_event_id) throw new Error('X accepted the message but returned no event id.')

    return {
      remoteId: String(sent.data.dm_event_id),
      conversationRemoteId,
      direction: 'outgoing',
      authorRemoteId: identity.userId,
      authorHandle: identity.handle,
      authorName: null,
      body,
      sentAt: new Date().toISOString(),
    }
  }
}
