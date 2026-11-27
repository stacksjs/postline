/**
 * The DM inbox.
 *
 * Postline's other social surfaces are write-mostly: you compose, it publishes.
 * DMs are the opposite — the network owns the conversation and Postline keeps a
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

import type { DmConversationCandidate, DmMessageCandidate, DmProvider } from '../Support/Social/direct-messages'
import { db } from '@stacksjs/database'
import { raw } from '@stacksjs/query-builder'
import { DM_PROVIDERS, DM_UNAVAILABLE, isDmProvider } from '../Support/Social/direct-messages'
import { isUsableIdentity } from '../Support/Social/accounts'
import { getDmTransport, listDmTransports } from './Social/DirectMessages'
import { listIdentityRows } from './Social/identities'
import { now, uuid } from './Social/support'
import { describeNetworkError } from '../Support/Social/network-errors'
import { UserFacingError } from '../Support/Http/user-error'
import { replyToTwitterDm, syncTwitterDmPage, TWITTER_DM_CHARACTER_LIMIT, twitterDmOptions } from './Social/TwitterDmInbox'

const database = db as any

/** Conversations pulled per network per sync. */
const CONVERSATION_LIMIT = 40

/** Messages pulled per conversation per sync, and returned per thread read. */
const MESSAGE_LIMIT = 100
/** Conversations per page of the inbox list (#105). */
export const CONVERSATION_PAGE = 50

/** A page offset from a request: a whole number, never negative. */
export function pageOffset(value: unknown): number {
  const offset = Math.floor(Number(value) || 0)
  return offset > 0 ? offset : 0
}

export interface DmSyncResult {
  synced: number
  conversations: number
  messages: number
  errors: Array<{ provider: DmProvider, message: string }>
}

function dmCharacterLimit(provider: DmProvider): number {
  return provider === 'twitter' ? TWITTER_DM_CHARACTER_LIMIT : getDmTransport(provider).characterLimit
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
    /** The account this conversation belongs to (#136). */
    identityId: row.social_identity_id ? Number(row.social_identity_id) : null,
  }
}

/** The account to act as for a stored conversation: its own, or the default when it has none. */
function conversationIdentity(conversation: any): number | null {
  return conversation?.social_identity_id ? Number(conversation.social_identity_id) : null
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

interface ConversationFilter {
  status?: string
  provider?: string
  identityId?: number | null
}

export class DirectMessageService {
  /**
   * Which networks the inbox can use right now, and why the others cannot.
   *
   * Split three ways on purpose: a network Postline supports but you have not
   * connected is a different problem from one Postline cannot support at all,
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

    const transports = listDmTransports()
    const accounts = await Promise.all(transports.map(async ({ provider }) => (await listIdentityRows<any>(provider))
      .filter(identity => isUsableIdentity(identity))
      .map(identity => ({ id: Number(identity.id), provider, handle: String(identity.handle) }))))
    const twitter = await twitterDmOptions()
    const unavailable = Object.entries(DM_UNAVAILABLE)
      .filter(([provider]) => connected.has(provider))
      .map(([provider, reason]) => ({ provider, reason }))
    if (connected.has('twitter') && !twitter.accounts.length) {
      unavailable.push({
        provider: 'twitter',
        reason: twitter.enabled ? 'Reconnect your X account in Channels to authorize Inbox messages.' : 'Enable X API messages in Channels to sync direct messages.',
      })
    }

    return {
      supported: transports.map(({ provider, characterLimit }) => ({
        provider,
        connected: connected.has(provider),
        handle: identities.find((identity: any) => identity.provider === provider)?.handle || null,
        characterLimit,
      })),
      // Every connected account the inbox reads, for the account filter (#136).
      accounts: [...accounts.flat(), ...twitter.accounts.map(account => ({ ...account, provider: 'twitter' as const }))],
      // Only networks this workspace has connected: the panel explains why a
      // network you use for publishing has no inbox here, and is no place to
      // list networks you never connected (or Postline no longer offers).
      unavailable,
      twitter,
    }
  }

  /** Count only conversations the selected Inbox tab can display. */
  async unreadCount(options: ConversationFilter = {}): Promise<number> {
    const row = await this.scopedInbox(database.selectFrom('dm_conversations'), options)
      .selectRaw({ raw: 'sum(unread_count) as total' })
      .executeTakeFirst()
    return Number(row?.total || 0)
  }

  private scopedInbox(query: any, options: ConversationFilter) {
    // Conversations from old connectors stay stored without appearing in Inbox.
    query = query.where('provider', 'in', [...DM_PROVIDERS])
      .whereRaw(raw`(provider <> 'twitter' OR social_identity_id IS NOT NULL)`)
      .where('status', '=', options.status === 'archived' ? 'archived' : 'open')
    if (isDmProvider(options.provider)) query = query.where('provider', '=', options.provider)
    if (options.identityId) query = query.where('social_identity_id', '=', options.identityId)
    return query
  }

  /** The inbox list, newest activity first. Reads the local mirror only. */
  async list(options: ConversationFilter & { offset?: number } = {}) {
    // A page at a time, one more than shown to know whether another follows.
    // It stopped at 200 conversations and said nothing of the rest (#105).
    const offset = pageOffset(options.offset)
    const rows = await this.scopedInbox(database.selectFrom('dm_conversations').selectAll(), options)
      .orderBy('last_message_at', 'desc')
      .orderBy('id', 'desc')
      .limit(CONVERSATION_PAGE + 1)
      .offset(offset)
      .execute()

    const page = rows.slice(0, CONVERSATION_PAGE)
    return {
      conversations: page.map(conversationRow),
      nextOffset: rows.length > CONVERSATION_PAGE ? offset + CONVERSATION_PAGE : null,
      unreadCount: await this.unreadCount(options),
      providers: await this.providers(),
    }
  }

  /**
   * One thread. Marks it read as a side effect — opening a conversation is the
   * only thing "read" can reasonably mean here, and making the caller issue a
   * second request would only invite the two to drift.
   */
  async thread(conversationId: number, options: { markRead?: boolean, offset?: number } = {}) {
    const conversation = await this.requireConversation(conversationId)
    // The newest messages, shown oldest first. Ordering ascending and then
    // limiting returned the first hundred ever exchanged, so a long
    // conversation opened on its beginning and never showed the latest reply.
    let messageQuery = database
      .selectFrom('dm_messages')
      .selectAll()
      .where('dm_conversation_id', '=', conversation.id)
      .orderBy('sent_at', 'desc')
    if (conversation.provider === 'twitter') messageQuery = messageQuery.orderBy('remote_id', 'desc')
    const newest = await messageQuery
      .orderBy('id', 'desc')
      .limit(MESSAGE_LIMIT + 1)
      .offset(pageOffset(options.offset))
      .execute()
    // `olderOffset` asks for the messages before these, a page at a time.
    const olderOffset = newest.length > MESSAGE_LIMIT ? pageOffset(options.offset) + MESSAGE_LIMIT : null
    const messages = newest.slice(0, MESSAGE_LIMIT).reverse()

    if (options.markRead !== false && Number(conversation.unread_count || 0) > 0)
      await this.markRead(conversationId)

    return {
      conversation: conversationRow({ ...conversation, unread_count: options.markRead === false ? conversation.unread_count : 0 }),
      messages: messages.map(messageRow),
      olderOffset,
      characterLimit: dmCharacterLimit(String(conversation.provider) as DmProvider),
    }
  }

  /**
   * Pull conversations and their messages from Bluesky and Mastodon.
   *
   * One network's failure is recorded and stepped over rather than thrown: a
   * dead Mastodon token should not stop Bluesky DMs from arriving, which is exactly
   * the failure mode that makes a multi-network inbox worth having.
   */
  async sync(options: { provider?: string, conversationId?: number } = {}): Promise<DmSyncResult> {
    if (options.conversationId) return await this.syncConversation(options.conversationId)

    const result: DmSyncResult = { synced: 0, conversations: 0, messages: 0, errors: [] }
    if (options.provider === 'twitter') return result
    const transports = listDmTransports().filter(transport => !isDmProvider(options.provider) || options.provider === transport.provider)

    // Every connected account on each network has an inbox of its own (#136).
    // A network with none connected still gets one pass, as its default
    // account, so a `.env` token keeps working.
    const runs: Array<{ transport: typeof transports[number], identityId: number | null }> = []
    for (const transport of transports) {
      const usable = (await listIdentityRows<any>(transport.provider)).filter(identity => isUsableIdentity(identity))
      if (usable.length) for (const identity of usable) runs.push({ transport, identityId: Number(identity.id) })
      else runs.push({ transport, identityId: null })
    }

    for (const { transport, identityId } of runs) {
      try {
        const candidates = await transport.listConversations(CONVERSATION_LIMIT, identityId)
        result.synced += 1

        for (const candidate of candidates) {
          const { id: conversationId, changed } = this.upsertConversation(transport.provider, candidate, identityId)
          result.conversations += 1
          // The preview is saved before fetching the history. A previous
          // failure may therefore leave an unchanged preview with missing
          // messages. Check the local mirror before skipping the remote read.
          if (!changed && await this.hasMirroredPreview(conversationId, candidate)) continue

          try {
            const messages = await transport.listMessages(candidate.remoteId, MESSAGE_LIMIT, identityId)
            result.messages += this.storeMessages(conversationId, transport.provider, messages)
          }
          catch (error) {
            // The conversation row is already saved, so the thread still shows
            // in the inbox with its preview — only its history is missing.
            result.errors.push({
              provider: transport.provider,
              message: `${candidate.participants[0]?.handle || candidate.remoteId}: ${describeNetworkError(transport.provider, error, 'read')}`,
            })
          }
        }
      }
      catch (error) {
        result.errors.push({ provider: transport.provider, message: describeNetworkError(transport.provider, error, 'read') })
      }
    }

    return result
  }

  async syncTwitter(identityId: number, older: boolean): Promise<DmSyncResult> {
    if (!Number.isSafeInteger(identityId) || identityId <= 0) throw new UserFacingError('Choose an X account in Inbox.')
    return await syncTwitterDmPage(identityId, older, (tx, batches) => {
      let messages = 0
      for (const batch of batches) {
        const { id } = this.upsertConversation('twitter', batch.conversation, identityId, tx)
        messages += this.storeMessages(id, 'twitter', batch.messages, tx)
        this.refreshPreview(id, 'twitter', tx)
      }
      return { synced: 1, conversations: batches.length, messages, errors: [] }
    })
  }

  /** Refresh a single thread — what the open conversation polls. */
  private async syncConversation(conversationId: number): Promise<DmSyncResult> {
    const conversation = await this.requireConversation(conversationId)
    const provider = String(conversation.provider) as DmProvider
    const result: DmSyncResult = { synced: 1, conversations: 1, messages: 0, errors: [] }
    if (provider === 'twitter') return result

    try {
      const messages = await getDmTransport(provider).listMessages(String(conversation.remote_id), MESSAGE_LIMIT, conversationIdentity(conversation))
      result.messages = this.storeMessages(conversationId, provider, messages)
      this.refreshPreview(conversationId, provider)
    }
    catch (error) {
      result.errors.push({ provider, message: describeNetworkError(provider, error, 'read') })
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
    const limit = dmCharacterLimit(provider)

    if (text.length > limit)
      throw new Error(`${provider === 'twitter' ? 'X' : provider.charAt(0).toUpperCase() + provider.slice(1)} messages must be ${limit} characters or fewer.`)

    // Replies go out from the account the conversation belongs to.
    const identityId = conversationIdentity(conversation)
    if (provider === 'twitter' && !identityId) throw new UserFacingError('This conversation is not linked to a connected X account.')
    const sent = provider === 'twitter'
      ? await replyToTwitterDm(identityId!, String(conversation.remote_id), text)
      : await getDmTransport(provider).sendMessage(String(conversation.remote_id), text, identityId)
    database.transaction((tx: typeof database) => {
      this.storeMessages(conversationId, provider, [{ ...sent, direction: 'outgoing' }], tx)
      this.refreshPreview(conversationId, provider, tx)
    })

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
   * app is not a reason to leave the thread bold in Postline.
   */
  async markRead(conversationId = 0): Promise<number> {
    let query = database.updateTable('dm_conversations').set({ unread_count: 0, updated_at: now() }).where('unread_count', '>', 0)
    if (conversationId) query = query.where('id', '=', conversationId)
    const result = await query.executeTakeFirst()

    const targets = conversationId
      ? await database.selectFrom('dm_conversations').selectAll().where('id', '=', conversationId).execute()
      : await database.selectFrom('dm_conversations').selectAll().where('status', '=', 'open').execute()

    for (const conversation of targets) {
      if (!isDmProvider(conversation.provider) || conversation.provider === 'twitter') continue
      const transport = getDmTransport(conversation.provider)
      if (!transport.markRead) continue
      try {
        await transport.markRead(String(conversation.remote_id), conversationIdentity(conversation))
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
      .whereRaw(raw`(provider <> 'twitter' OR social_identity_id IS NOT NULL)`)
      .executeTakeFirst()

    if (!conversation) throw new Error('That conversation is not in your inbox.')

    return conversation
  }

  /**
   * Insert or update one conversation, keyed on (provider, remote id).
   *
   * `unread_count` is only ever raised by a provider-reported value, never
   * lowered: X reports none at all, and letting a zero from one network stomp
   * a count Postline is tracking locally would silently mark threads read.
   */
  private upsertConversation(provider: DmProvider, candidate: DmConversationCandidate, identityId: number | null = null, store = database): { id: number, changed: boolean } {
    // Keyed on (provider, account, remote id): two of the owner's accounts in
    // one conversation are two inbox rows, each answering as its own account.
    // A row stored before conversations had an account is adopted by the
    // first account that sees it.
    const sameRemote = store
      .selectFrom('dm_conversations')
      .selectAll()
      .where('provider', '=', provider)
      .where('remote_id', '=', candidate.remoteId)
      .get()
    const existing = sameRemote.find((row: any) => (row.social_identity_id ? Number(row.social_identity_id) : null) === identityId)
      ?? (identityId ? sameRemote.find((row: any) => !row.social_identity_id) : undefined)

    const primary = candidate.participants[0]
    const keepProfile = provider === 'twitter' && primary && existing?.participant_remote_id === primary.remoteId && primary.handle === primary.remoteId

    const values: Record<string, unknown> = {
      provider,
      remote_id: candidate.remoteId,
      participant_handle: keepProfile ? existing.participant_handle : participantLabel(candidate.participants.map(person => person.handle)),
      participant_name: keepProfile ? existing.participant_name : primary?.name || null,
      participant_avatar: keepProfile ? existing.participant_avatar : primary?.avatar || null,
      participant_remote_id: primary?.remoteId || null,
      last_message_at: candidate.lastMessageAt ? sqliteTimestamp(candidate.lastMessageAt) : existing?.last_message_at || null,
      last_message_preview: (candidate.lastMessageText || existing?.last_message_preview || '').slice(0, 500) || null,
      last_message_outgoing: candidate.lastMessageOutgoing ? 1 : 0,
      social_identity_id: identityId,
      updated_at: now(),
    }

    if (candidate.unreadCount > 0) values.unread_count = candidate.unreadCount

    if (existing) {
      // Changed when the network reports a newer last message than the one
      // stored, or does not say (then the messages are fetched to find out).
      const changed = !candidate.lastMessageAt || String(values.last_message_at) !== String(existing.last_message_at)
        || Number(candidate.unreadCount || 0) > Number(existing.unread_count || 0)
      store.updateTable('dm_conversations').set(values).where('id', '=', existing.id).execute()
      return { id: Number(existing.id), changed }
    }

    const conversationUuid = uuid()
    const created = store.insertInto('dm_conversations').values({
      ...values,
      uuid: conversationUuid,
      unread_count: candidate.unreadCount || 0,
      status: 'open',
      created_at: now(),
    }).returning('id').first()

    return { id: Number(created.id), changed: true }
  }

  private async hasMirroredPreview(conversationId: number, candidate: DmConversationCandidate): Promise<boolean> {
    const query = database.selectFrom('dm_messages').select(['id']).where('dm_conversation_id', '=', conversationId)
    if (candidate.lastMessageRemoteId)
      return Boolean(await query.where('remote_id', '=', candidate.lastMessageRemoteId).limit(1).executeTakeFirst())

    if (!candidate.lastMessageAt) return false
    return Boolean(await query.where('sent_at', '>=', sqliteTimestamp(candidate.lastMessageAt)).limit(1).executeTakeFirst())
  }

  /**
   * Store messages, skipping ones already mirrored, and return how many were
   * new. Incoming messages that are new also bump the conversation's unread
   * count — this is the only place unread is raised for networks (X) that do
   * not report it.
   */
  private storeMessages(conversationId: number, provider: DmProvider, candidates: DmMessageCandidate[], store = database): number {
    let created = 0
    let freshIncoming = 0

    // One query for which of these are stored already, not one per message (#108).
    const remoteIds = candidates.map(candidate => candidate.remoteId)
    const stored = remoteIds.length
      ? new Set((store
          .selectFrom('dm_messages')
          .select(['remote_id'])
          .where('dm_conversation_id', '=', conversationId)
          .where('remote_id', 'in', remoteIds)
          .get()).map((row: { remote_id: string }) => String(row.remote_id)))
      : new Set<string>()

    for (const candidate of candidates) {
      if (stored.has(candidate.remoteId)) continue
      stored.add(candidate.remoteId)

      store.insertInto('dm_messages').values({
        uuid: uuid(),
        dm_conversation_id: conversationId,
        provider,
        remote_id: candidate.remoteId,
        direction: candidate.direction,
        author_handle: candidate.authorHandle,
        author_name: candidate.authorName || null,
        body: candidate.body.slice(0, 10000),
        status: candidate.direction === 'outgoing' ? 'sent' : 'received',
        failure_reason: null,
        sent_at: sqliteTimestamp(candidate.sentAt),
        created_at: now(),
        updated_at: now(),
      }).execute()

      created += 1
      if (candidate.direction === 'incoming') freshIncoming += 1
    }

    if (freshIncoming) {
      const conversation = store
        .selectFrom('dm_conversations')
        .select(['unread_count'])
        .where('id', '=', conversationId)
        .first()

      store.updateTable('dm_conversations').set({
        unread_count: Number(conversation?.unread_count || 0) + freshIncoming,
        updated_at: now(),
      }).where('id', '=', conversationId).execute()
    }

    return created
  }

  /** Re-derive the conversation preview from its newest stored message. */
  private refreshPreview(conversationId: number, provider: DmProvider, store = database): void {
    let query = store
      .selectFrom('dm_messages')
      .selectAll()
      .where('dm_conversation_id', '=', conversationId)
      .orderBy('sent_at', 'desc')
    if (provider === 'twitter') query = query.orderBy('remote_id', 'desc')
    const latest = query.orderBy('id', 'desc').first()

    if (!latest) return

    store.updateTable('dm_conversations').set({
      last_message_at: latest.sent_at,
      last_message_preview: String(latest.body || '').slice(0, 500),
      last_message_outgoing: latest.direction === 'outgoing' ? 1 : 0,
      updated_at: now(),
    }).where('id', '=', conversationId).execute()
  }
}

export const directMessages = new DirectMessageService()
