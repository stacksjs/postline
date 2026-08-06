/**
 * The DM inbox.
 *
 * The Open Times' other social surfaces are write-mostly: you compose, it publishes.
 * DMs are the opposite — the network owns the conversation and The Open Times keeps a
 * local mirror of it so the inbox stays readable when a network is slow, rate
 * limited, or disconnected, and so unread state survives a page reload.
 *
 * That mirror is the reason for the two-step read path. `sync` pulls from every
 * connected network and writes rows; `list` and `thread` only ever read the
 * database. A failing network therefore degrades to stale data plus an error
 * banner, instead of an empty inbox.
 *
 * Sending is deliberately not mirrored the same way: `reply` writes the row
 * only after the network accepts the message, so nothing can sit in the thread
 * claiming to have been delivered when it was not.
 */

import type { DmMessageCandidate, DmProvider } from '../Support/Social/direct-messages'
import { db } from '@stacksjs/database'
import { DM_PROVIDERS, DM_UNAVAILABLE, isDmProvider } from '../Support/Social/direct-messages'
import { getDmTransport, listDmTransports } from './Social/DirectMessages'
import { now, uuid } from './Social/support'

const database = db as any

/** Conversations pulled per network per sync. */
const CONVERSATION_LIMIT = 40

/** Messages pulled per conversation per sync, and returned per thread read. */
const MESSAGE_LIMIT = 100

export interface DmSyncResult {
  synced: number
  conversations: number
  messages: number
  errors: Array<{ provider: DmProvider, message: string }>
}

function sqliteTimestamp(value: unknown): string {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? now() : date.toISOString().slice(0, 19).replace('T', ' ')
}

function conversationRow(row: any) {
  return {
    id: Number(row.id),
    provider: String(row.provider) as DmProvider,
    remoteId: String(row.remote_id),
    participantHandle: String(row.participant_handle),
    participantName: row.participant_name || null,
    participantAvatar: row.participant_avatar || null,
    lastMessageAt: row.last_message_at || null,
    lastMessagePreview: row.last_message_preview || null,
    lastMessageOutgoing: Boolean(Number(row.last_message_outgoing || 0)),
    unreadCount: Number(row.unread_count || 0),
    status: row.status === 'archived' ? 'archived' : 'open',
  }
}

function messageRow(row: any) {
  return {
    id: Number(row.id),
    conversationId: Number(row.dm_conversation_id),
    provider: String(row.provider) as DmProvider,
    remoteId: String(row.remote_id),
    direction: row.direction === 'outgoing' ? 'outgoing' : 'incoming',
    authorHandle: String(row.author_handle),
    authorName: row.author_name || null,
    body: String(row.body),
    status: String(row.status || 'received'),
    failureReason: row.failure_reason || null,
    sentAt: row.sent_at,
  }
}

/** A conversation with no named participant still needs something to show. */
function participantLabel(handles: string[]): string {
  const [first, ...rest] = handles
  if (!first) return 'Unknown sender'

  return rest.length ? `${first} +${rest.length}` : first
}

export class DirectMessageService {
  /**
   * Which networks the inbox can use right now, and why the others cannot.
   *
   * Split three ways on purpose: a network The Open Times supports but you have not
   * connected is a different problem from one The Open Times cannot support at all,
   * and the inbox should not present them identically.
   */
  async providers() {
    const identities = await database
      .selectFrom('social_identities')
      .select(['provider', 'handle', 'auth_status', 'access_token'])
      .execute()

    const connected = new Set(identities
      .filter((identity: any) => identity.auth_status === 'connected' && identity.access_token)
      .map((identity: any) => String(identity.provider)))

    return {
      supported: DM_PROVIDERS.map(provider => ({
        provider,
        connected: connected.has(provider),
        handle: identities.find((identity: any) => identity.provider === provider)?.handle || null,
        characterLimit: getDmTransport(provider).characterLimit,
      })),
      unavailable: Object.entries(DM_UNAVAILABLE).map(([provider, reason]) => ({ provider, reason })),
    }
  }

  /** The inbox list, newest activity first. Reads the local mirror only. */
  async list(options: { status?: string, provider?: string } = {}) {
    let query = database.selectFrom('dm_conversations').selectAll()
    query = query.where('status', '=', options.status === 'archived' ? 'archived' : 'open')
    if (isDmProvider(options.provider)) query = query.where('provider', '=', options.provider)

    const rows = await query
      .orderBy('last_message_at', 'desc')
      .limit(200)
      .execute()

    const conversations = rows.map(conversationRow)

    return {
      conversations,
      unreadCount: conversations.reduce((total: number, conversation: any) => total + conversation.unreadCount, 0),
      providers: await this.providers(),
    }
  }

  /**
   * One thread. Marks it read as a side effect — opening a conversation is the
   * only thing "read" can reasonably mean here, and making the caller issue a
   * second request would only invite the two to drift.
   */
  async thread(conversationId: number, options: { markRead?: boolean } = {}) {
    const conversation = await this.requireConversation(conversationId)
    const messages = await database
      .selectFrom('dm_messages')
      .selectAll()
      .where('dm_conversation_id', '=', conversation.id)
      .orderBy('sent_at', 'asc')
      .orderBy('id', 'asc')
      .limit(MESSAGE_LIMIT)
      .execute()

    if (options.markRead !== false && Number(conversation.unread_count || 0) > 0)
      await this.markRead(conversationId)

    return {
      conversation: conversationRow({ ...conversation, unread_count: options.markRead === false ? conversation.unread_count : 0 }),
      messages: messages.map(messageRow),
      characterLimit: getDmTransport(String(conversation.provider) as DmProvider).characterLimit,
    }
  }

  /**
   * Pull conversations and their messages from every connected network.
   *
   * One network's failure is recorded and stepped over rather than thrown: a
   * dead X token should not stop Bluesky DMs from arriving, which is exactly
   * the failure mode that makes a multi-network inbox worth having.
   */
  async sync(options: { provider?: string, conversationId?: number } = {}): Promise<DmSyncResult> {
    if (options.conversationId) return await this.syncConversation(options.conversationId)

    const transports = isDmProvider(options.provider)
      ? [getDmTransport(options.provider)]
      : listDmTransports()

    const result: DmSyncResult = { synced: 0, conversations: 0, messages: 0, errors: [] }

    for (const transport of transports) {
      try {
        const candidates = await transport.listConversations(CONVERSATION_LIMIT)
        result.synced += 1

        for (const candidate of candidates) {
          const conversationId = await this.upsertConversation(transport.provider, candidate)
          result.conversations += 1

          try {
            const messages = await transport.listMessages(candidate.remoteId, MESSAGE_LIMIT)
            result.messages += await this.storeMessages(conversationId, transport.provider, messages)
          }
          catch (error) {
            // The conversation row is already saved, so the thread still shows
            // in the inbox with its preview — only its history is missing.
            result.errors.push({
              provider: transport.provider,
              message: `${candidate.participants[0]?.handle || candidate.remoteId}: ${error instanceof Error ? error.message : String(error)}`,
            })
          }
        }
      }
      catch (error) {
        result.errors.push({ provider: transport.provider, message: error instanceof Error ? error.message : String(error) })
      }
    }

    return result
  }

  /** Refresh a single thread — what the open conversation polls. */
  private async syncConversation(conversationId: number): Promise<DmSyncResult> {
    const conversation = await this.requireConversation(conversationId)
    const provider = String(conversation.provider) as DmProvider
    const result: DmSyncResult = { synced: 1, conversations: 1, messages: 0, errors: [] }

    try {
      const messages = await getDmTransport(provider).listMessages(String(conversation.remote_id), MESSAGE_LIMIT)
      result.messages = await this.storeMessages(conversationId, provider, messages)
      await this.refreshPreview(conversationId)
    }
    catch (error) {
      result.errors.push({ provider, message: error instanceof Error ? error.message : String(error) })
    }

    return result
  }

  /**
   * Send a reply into an existing conversation.
   *
   * The network call comes first and the row second, so a thread never shows a
   * message that was not actually delivered. The cost is that a send which
   * succeeds remotely but fails to persist locally is invisible until the next
   * sync — the safer of the two failure modes.
   */
  async reply(conversationId: number, body: string) {
    const text = String(body || '').trim()
    if (!text) throw new Error('Write a message before sending.')

    const conversation = await this.requireConversation(conversationId)
    const provider = String(conversation.provider) as DmProvider
    const transport = getDmTransport(provider)

    if (text.length > transport.characterLimit)
      throw new Error(`${provider === 'twitter' ? 'X' : provider} messages must be ${transport.characterLimit} characters or fewer.`)

    const sent = await transport.sendMessage(String(conversation.remote_id), text)
    await this.storeMessages(conversationId, provider, [{ ...sent, direction: 'outgoing' }], 'sent')
    await this.refreshPreview(conversationId)

    const messages = await database
      .selectFrom('dm_messages')
      .selectAll()
      .where('dm_conversation_id', '=', conversationId)
      .where('remote_id', '=', sent.remoteId)
      .executeTakeFirst()

    return messageRow(messages)
  }

  /**
   * Clear unread state locally, and on the network when it has a notion of it.
   *
   * The remote half is best-effort: failing to clear a badge in the official
   * app is not a reason to leave the thread bold in The Open Times.
   */
  async markRead(conversationId = 0): Promise<number> {
    let query = database.updateTable('dm_conversations').set({ unread_count: 0, updated_at: now() }).where('unread_count', '>', 0)
    if (conversationId) query = query.where('id', '=', conversationId)
    const result = await query.executeTakeFirst()

    const targets = conversationId
      ? await database.selectFrom('dm_conversations').selectAll().where('id', '=', conversationId).execute()
      : await database.selectFrom('dm_conversations').selectAll().where('status', '=', 'open').execute()

    for (const conversation of targets) {
      const transport = getDmTransport(String(conversation.provider) as DmProvider)
      if (!transport.markRead) continue
      try {
        await transport.markRead(String(conversation.remote_id))
      }
      catch {}
    }

    return Number(result?.numUpdatedRows || 0)
  }

  /** Hide a thread from the inbox without deleting its history. */
  async setStatus(conversationId: number, status: 'open' | 'archived') {
    await this.requireConversation(conversationId)
    await database.updateTable('dm_conversations')
      .set({ status, updated_at: now() })
      .where('id', '=', conversationId)
      .execute()

    return conversationRow(await database.selectFrom('dm_conversations').selectAll().where('id', '=', conversationId).executeTakeFirstOrThrow())
  }

  private async requireConversation(conversationId: number) {
    const conversation = await database
      .selectFrom('dm_conversations')
      .selectAll()
      .where('id', '=', Number(conversationId) || 0)
      .executeTakeFirst()

    if (!conversation) throw new Error('That conversation is not in your inbox.')

    return conversation
  }

  /**
   * Insert or update one conversation, keyed on (provider, remote id).
   *
   * `unread_count` is only ever raised by a provider-reported value, never
   * lowered: X reports none at all, and letting a zero from one network stomp
   * a count The Open Times is tracking locally would silently mark threads read.
   */
  private async upsertConversation(provider: DmProvider, candidate: {
    remoteId: string
    participants: Array<{ remoteId: string, handle: string, name?: string | null, avatar?: string | null }>
    unreadCount: number
    lastMessageAt?: string | null
    lastMessageText?: string | null
    lastMessageOutgoing?: boolean
  }): Promise<number> {
    const existing = await database
      .selectFrom('dm_conversations')
      .selectAll()
      .where('provider', '=', provider)
      .where('remote_id', '=', candidate.remoteId)
      .executeTakeFirst()

    const primary = candidate.participants[0]
    const identity = await database
      .selectFrom('social_identities')
      .select(['id'])
      .where('provider', '=', provider)
      .orderBy('updated_at', 'desc')
      .executeTakeFirst()

    const values: Record<string, unknown> = {
      provider,
      remote_id: candidate.remoteId,
      participant_handle: participantLabel(candidate.participants.map(person => person.handle)),
      participant_name: primary?.name || null,
      participant_avatar: primary?.avatar || null,
      participant_remote_id: primary?.remoteId || null,
      last_message_at: candidate.lastMessageAt ? sqliteTimestamp(candidate.lastMessageAt) : existing?.last_message_at || null,
      last_message_preview: (candidate.lastMessageText || existing?.last_message_preview || '').slice(0, 500) || null,
      last_message_outgoing: candidate.lastMessageOutgoing ? 1 : 0,
      social_identity_id: identity?.id || null,
      updated_at: now(),
    }

    if (candidate.unreadCount > 0) values.unread_count = candidate.unreadCount

    if (existing) {
      await database.updateTable('dm_conversations').set(values).where('id', '=', existing.id).execute()
      return Number(existing.id)
    }

    const conversationUuid = uuid()
    await database.insertInto('dm_conversations').values({
      ...values,
      uuid: conversationUuid,
      unread_count: candidate.unreadCount || 0,
      status: 'open',
      created_at: now(),
    }).execute()

    const created = await database
      .selectFrom('dm_conversations')
      .select(['id'])
      .where('uuid', '=', conversationUuid)
      .executeTakeFirstOrThrow()

    return Number(created.id)
  }

  /**
   * Store messages, skipping ones already mirrored, and return how many were
   * new. Incoming messages that are new also bump the conversation's unread
   * count — this is the only place unread is raised for networks (X) that do
   * not report it.
   */
  private async storeMessages(conversationId: number, provider: DmProvider, candidates: DmMessageCandidate[], status: 'received' | 'sent' = 'received'): Promise<number> {
    let created = 0
    let freshIncoming = 0

    for (const candidate of candidates) {
      const existing = await database
        .selectFrom('dm_messages')
        .select(['id'])
        .where('dm_conversation_id', '=', conversationId)
        .where('remote_id', '=', candidate.remoteId)
        .executeTakeFirst()

      if (existing) continue

      await database.insertInto('dm_messages').values({
        uuid: uuid(),
        dm_conversation_id: conversationId,
        provider,
        remote_id: candidate.remoteId,
        direction: candidate.direction,
        author_handle: candidate.authorHandle,
        author_name: candidate.authorName || null,
        body: candidate.body.slice(0, 10000),
        status: candidate.direction === 'outgoing' ? 'sent' : status,
        failure_reason: null,
        sent_at: sqliteTimestamp(candidate.sentAt),
        created_at: now(),
        updated_at: now(),
      }).execute()

      created += 1
      if (candidate.direction === 'incoming') freshIncoming += 1
    }

    if (freshIncoming) {
      const conversation = await database
        .selectFrom('dm_conversations')
        .select(['unread_count'])
        .where('id', '=', conversationId)
        .executeTakeFirst()

      await database.updateTable('dm_conversations').set({
        unread_count: Number(conversation?.unread_count || 0) + freshIncoming,
        updated_at: now(),
      }).where('id', '=', conversationId).execute()
    }

    return created
  }

  /** Re-derive the conversation preview from its newest stored message. */
  private async refreshPreview(conversationId: number): Promise<void> {
    const latest = await database
      .selectFrom('dm_messages')
      .selectAll()
      .where('dm_conversation_id', '=', conversationId)
      .orderBy('sent_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst()

    if (!latest) return

    await database.updateTable('dm_conversations').set({
      last_message_at: latest.sent_at,
      last_message_preview: String(latest.body || '').slice(0, 500),
      last_message_outgoing: latest.direction === 'outgoing' ? 1 : 0,
      updated_at: now(),
    }).where('id', '=', conversationId).execute()
  }
}

export const directMessages = new DirectMessageService()
