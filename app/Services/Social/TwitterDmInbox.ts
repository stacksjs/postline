import type { TwitterDirectMessagePage } from '@stacksjs/socials'
import type { DmConversationCandidate, DmMessageCandidate } from '../../Support/Social/direct-messages'
import { db, sqliteWriteOptions } from '@stacksjs/database'
import { UserFacingError } from '../../Support/Http/user-error'
import { networkApps } from '../NetworkAppService'
import { TwitterApiError } from './Drivers/TwitterDriver'
import { TWITTER_READ_PRICE, twitterReadUsage, withTwitterReadBudget } from './TwitterReadBudget'
import { twitter } from './TwitterService'

const database = db
const PAGE_LIMIT = 25
const MAX_PAGE_MICROS = PAGE_LIMIT * (TWITTER_READ_PRICE.directMessage + TWITTER_READ_PRICE.user)
const CLAIM_DURATION_MS = 60_000 // The driver times out after 15 seconds.
export const TWITTER_DM_CHARACTER_LIMIT = 10_000

interface Checkpoint {
  newest?: string
  recent?: { cursor: string, newest: string }
  older?: { cursor?: string, before: string }
  claim?: number
}

type Transaction = Parameters<Parameters<typeof database.transaction>[0]>[0]

export interface TwitterDmBatch {
  conversation: DmConversationCandidate
  messages: DmMessageCandidate[]
}

interface MessagePart {
  id: string
  index: bigint
  conversationId: string
  senderId: string
  text: string
  sentAt: string
}

function checkpoint(raw: string | null): Checkpoint {
  return raw ? JSON.parse(raw) as Checkpoint : {}
}

export async function twitterDmOptions() {
  const enabled = (await networkApps.credentials('twitter')).directMessages
  const rows = enabled
    ? database.selectFrom('social_identities').select(['id', 'handle', 'twitter_dm_state'])
        .where('provider', '=', 'twitter').where('auth_status', '=', 'connected')
        .where('twitter_dm_consent', '=', 1).where('access_token', 'is not', null)
        .orderBy('id', 'asc').get()
    : []
  return {
    enabled,
    accounts: rows.map(row => ({ id: row.id, handle: row.handle, older: Boolean(checkpoint(row.twitter_dm_state).older) })),
    readUsage: enabled ? await twitterReadUsage() : null,
    maxReadUsd: MAX_PAGE_MICROS / 1_000_000,
    replyUsd: 0.015,
  }
}

function readMessages(page: TwitterDirectMessagePage): MessagePart[] {
  return page.events.map((event) => {
    if (!/^\d{1,19}$/.test(event.id) || !/^\d{1,19}(?:-\d{1,19})?$/.test(event.dm_conversation_id)
      || !event.sender_id || !event.created_at || !Number.isFinite(Date.parse(event.created_at))) {
      throw new UserFacingError('X returned an incomplete message page. Refresh again to retry this page.')
    }
    return {
      id: event.id,
      index: BigInt(event.id),
      conversationId: event.dm_conversation_id,
      senderId: event.sender_id,
      sentAt: event.created_at,
      text: event.text || (event.attachments ? 'Attachment on X' : ''),
    }
  }).sort((one, other) => one.index < other.index ? -1 : Number(one.index > other.index))
}

function groupMessages(messages: MessagePart[], users: TwitterDirectMessagePage['users'], account: { did: string, handle: string }): TwitterDmBatch[] {
  const profiles = new Map(users.map(user => [user.id, user]))
  const grouped = new Map<string, DmMessageCandidate[]>()
  for (const message of messages) {
    const author = profiles.get(message.senderId)
    const outgoing = message.senderId === account.did
    const thread = grouped.get(message.conversationId) ?? []
    thread.push({
      remoteId: message.id,
      conversationRemoteId: message.conversationId,
      authorRemoteId: message.senderId,
      authorHandle: outgoing ? account.handle : author?.username || message.senderId,
      authorName: author?.name ?? null,
      direction: outgoing ? 'outgoing' : 'incoming',
      body: message.text,
      sentAt: message.sentAt,
    })
    grouped.set(message.conversationId, thread)
  }

  return [...grouped].map(([remoteId, messages]) => {
    const partnerId = remoteId.split('-').find(userId => userId !== account.did)
    const oneToOne = remoteId.includes('-') && partnerId
    const partner = oneToOne ? profiles.get(partnerId) : undefined
    const participants = oneToOne
      ? [{ remoteId: partnerId, handle: partner?.username || partnerId, name: partner?.name, avatar: partner?.profile_image_url }]
      : [{ remoteId, handle: `X group ${remoteId}`, name: 'X group' }]
    const newest = messages[messages.length - 1]!
    return {
      conversation: {
        remoteId, participants, unreadCount: 0, lastMessageRemoteId: newest.remoteId,
        lastMessageAt: newest.sentAt, lastMessageText: newest.body, lastMessageOutgoing: newest.direction === 'outgoing',
      },
      messages,
    }
  })
}

function planPage(state: Checkpoint, page: MessagePart[], cursor: string | undefined, older: boolean) {
  if (older && state.older) {
    const boundary = BigInt(state.older.before)
    const messages = page.filter(message => message.index < boundary)
    const before = messages[0]?.id ?? state.older.before
    return { messages, state: { ...state, older: cursor ? { cursor, before } : undefined } }
  }
  if (!state.newest) {
    const before = page[0]?.id
    return { messages: page, state: { newest: page.at(-1)?.id, older: before && cursor ? { before, cursor } : undefined } }
  }
  const boundary = BigInt(state.newest)
  const messages = page.filter(message => message.index > boundary)
  const newest = state.recent?.newest ?? messages.at(-1)?.id ?? state.newest
  const recent = cursor && page.length === messages.length ? { cursor, newest } : undefined
  return { messages, state: { ...state, newest: recent ? state.newest : newest, recent } }
}

/** One paid, user-initiated page. Commit its mirror and checkpoint together. */
export async function syncTwitterDmPage<T>(identityId: number, older: boolean, store: (tx: Transaction, batches: TwitterDmBatch[]) => T): Promise<T> {
  return await twitter.withDirectMessages(identityId, async (account, driver) => {
    const { raw, state, claimed } = database.transaction((tx) => {
      const row = tx.selectFrom('social_identities').select!(['twitter_dm_state']).where('id', '=', identityId)
        .where('auth_status', '=', 'connected').where('twitter_dm_consent', '=', 1).first!()
      if (!row) throw new UserFacingError('Reconnect this X account in Channels to allow Inbox messages.')
      const raw = typeof row.twitter_dm_state === 'string' ? row.twitter_dm_state : null
      const state = checkpoint(raw)
      if (state.claim && state.claim > Date.now()) throw new UserFacingError('This X inbox is already refreshing.')
      if (older && !state.older) throw new UserFacingError('There are no more older X messages to load.')
      const claimed = JSON.stringify({ ...state, claim: Date.now() + CLAIM_DURATION_MS })
      tx.updateTable('social_identities').set({ twitter_dm_state: claimed }).where('id', '=', identityId).execute()
      return { raw, state, claimed }
    }, sqliteWriteOptions())

    const cursor = older ? state.older?.cursor : state.recent?.cursor
    let rollback = raw
    try {
      const page = await withTwitterReadBudget(MAX_PAGE_MICROS, async () => {
        const value = await driver.listDirectMessageEvents(account, { limit: PAGE_LIMIT, cursor })
        return { value, estimatedMicros: value.events.length * TWITTER_READ_PRICE.directMessage + value.users.length * TWITTER_READ_PRICE.user }
      })
      if (page.cursor && page.cursor === cursor) throw new UserFacingError('X returned the same message page again. Refresh again to retry.')
      const next = planPage(state, readMessages(page), page.cursor, older)
      const batches = groupMessages(next.messages, page.users, account)

      return database.transaction((tx) => {
        const target = tx.updateTable('social_identities').set({ twitter_dm_state: JSON.stringify({ ...next.state, claim: undefined }) })
          .where('id', '=', identityId).where('auth_status', '=', 'connected').where('twitter_dm_consent', '=', 1)
          .where('twitter_dm_state', '=', claimed).returning('id').first()
        if (!target) throw new UserFacingError('This X account changed during the refresh. Refresh it again from Inbox.')
        return store(tx, batches)
      }, sqliteWriteOptions())
    }
    catch (error) {
      if (cursor && error instanceof TwitterApiError && error.status === 400 && /pagination[_ ]token|cursor/i.test(error.reason)) {
        rollback = JSON.stringify({ ...state, claim: undefined, ...(older && state.older ? { older: { before: state.older.before } } : { recent: undefined }) })
        throw new UserFacingError('X expired the message cursor. Refresh again to resume from the last saved messages.')
      }
      throw error
    }
    finally {
      database.updateTable('social_identities').set({ twitter_dm_state: rollback })
        .where('id', '=', identityId).where('twitter_dm_state', '=', claimed).execute()
    }
  })
}

export async function replyToTwitterDm(identityId: number, conversationId: string, body: string): Promise<DmMessageCandidate> {
  return await twitter.withDirectMessages(identityId, async (account, driver) => {
    const sent = await driver.sendDirectMessage(account, conversationId, body)
    return {
      remoteId: sent.eventId, conversationRemoteId: sent.conversationId, direction: 'outgoing',
      authorRemoteId: account.did, authorHandle: account.handle, body, sentAt: new Date().toISOString(),
    }
  })
}
