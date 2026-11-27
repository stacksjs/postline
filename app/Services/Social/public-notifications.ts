import { UserFacingError } from '../../Support/Http/user-error'
import { safeFetch } from '../../Support/Http/safe-fetch'
import { resolveBlueskyServer } from '../../Support/Social/bluesky-server'
import { stripHtml } from '../../Support/Social/text'
import { bluesky } from './BlueskyService'
import { BlueskyApiError } from './Drivers/BlueskyDriver'
import { mastodon } from './MastodonService'

export const PUBLIC_INBOX_PROVIDERS = ['bluesky', 'mastodon'] as const
export type PublicInboxProvider = typeof PUBLIC_INBOX_PROVIDERS[number]

export interface PublicNotification {
  remoteId: string
  kind: 'reply' | 'mention'
  author: string
  body: string
  url: string
  postedAt: string
}

type Page = { items: PublicNotification[], next?: string }
const LIMIT = 30
const BLUESKY_POST_URI = /^at:\/\/(did:[a-z]+:[\w.%:-]+)\/app\.bsky\.feed\.post\/([\w.~:-]{1,512})$/

interface BlueskyNotification {
  uri?: string
  reason?: string
  author?: { did?: string, handle?: string }
  record?: { text?: string }
  indexedAt?: string
}
interface MastodonNotification {
  id?: string
  type?: string
  account?: { acct?: string, username?: string }
  status?: { id?: string, url?: string | null, uri?: string, visibility?: string, content?: string, spoiler_text?: string, created_at?: string, in_reply_to_id?: string | null }
}

export function blueskyNotification(entry: BlueskyNotification): PublicNotification | undefined {
  if (entry.reason !== 'reply' && entry.reason !== 'mention') return
  const match = BLUESKY_POST_URI.exec(entry.uri ?? '')
  if (!match || match[2] === '.' || match[2] === '..' || !entry.author?.handle || entry.author.did !== match[1]) return
  return {
    remoteId: entry.uri!,
    kind: entry.reason,
    author: entry.author.handle,
    body: entry.record?.text ?? '',
    url: `https://bsky.app/profile/${encodeURIComponent(match[1]!)}/post/${encodeURIComponent(match[2]!)}`,
    postedAt: entry.indexedAt || '',
  }
}

export function mastodonNotification(entry: MastodonNotification): PublicNotification | undefined {
  const status = entry.status
  if (entry.type !== 'mention' || !entry.id || !status || (status.visibility !== 'public' && status.visibility !== 'unlisted')) return
  const author = entry.account?.acct || entry.account?.username
  const address = status.url || status.uri
  if (!author || !address) return
  const url = URL.parse(address)
  if (!url || url.protocol !== 'https:' || url.username || url.password) return
  return {
    remoteId: entry.id,
    kind: status.in_reply_to_id ? 'reply' : 'mention',
    author,
    body: status.spoiler_text ? `Content warning · ${stripHtml(status.spoiler_text)}` : stripHtml(status.content || ''),
    url: url.href,
    postedAt: status.created_at || '',
  }
}

async function request(url: URL, accessToken: string) {
  if (url.protocol !== 'https:') throw new Error('Inbox notifications require an HTTPS account server.')
  const result = await safeFetch(url.href, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    redirect: 'error',
    timeoutMs: 15_000,
    maxBytes: 2_000_000,
  })
  if (result.truncated) throw new Error('The network returned more notification data than Postline can read.')
  return { status: result.status, body: new TextDecoder().decode(result.bytes) }
}

export async function publicNotifications(provider: PublicInboxProvider, identityId: number, cursor?: string): Promise<Page> {
  if (provider === 'bluesky') {
    return bluesky.withSession(async (identity) => {
      const server = await resolveBlueskyServer(identity.did || identity.handle)
      const url = new URL('/xrpc/app.bsky.notification.listNotifications', server)
      url.searchParams.set('limit', String(LIMIT))
      url.searchParams.append('reasons', 'reply')
      url.searchParams.append('reasons', 'mention')
      if (cursor) url.searchParams.set('cursor', cursor)
      const { status, body } = await request(url, identity.accessToken!)
      if (status < 200 || status >= 300)
        throw new BlueskyApiError(`Bluesky notifications returned HTTP ${status}.`, status, body)
      const data = JSON.parse(body) as { notifications: BlueskyNotification[], cursor?: string }
      return { items: data.notifications.flatMap(entry => blueskyNotification(entry) ?? []), next: data.cursor }
    }, identityId)
  }

  const identity = await mastodon.dmIdentity(identityId)
  const url = new URL('/api/v1/notifications', identity.instance)
  url.searchParams.set('limit', String(LIMIT))
  url.searchParams.set('types[]', 'mention')
  if (cursor) url.searchParams.set('max_id', cursor)
  const { status, body } = await request(url, identity.accessToken)
  if (status === 403) throw new Error('Reconnect Mastodon with a token that allows read:notifications.')
  if (status < 200 || status >= 300) throw new Error(`Mastodon notifications returned HTTP ${status}.`)
  const data = JSON.parse(body) as MastodonNotification[]
  return { items: data.flatMap(entry => mastodonNotification(entry) ?? []), next: data.length === LIMIT ? data.at(-1)?.id : undefined }
}

type Reply = NonNullable<import('../../Support/Social/types').PublishContent['reply']>

export interface PublicReplyParent {
  reply: Reply
  visibility?: 'public' | 'unlisted'
}

const MASTODON_ID = /^\d{1,32}$/

function isBlueskyPostUri(input: unknown): input is string {
  if (typeof input !== 'string') return false
  const match = BLUESKY_POST_URI.exec(input)
  return !!match && match[2] !== '.' && match[2] !== '..'
}

function isBlueskyRef(value: unknown): value is Reply['parent'] {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Reply['parent']>
  return isBlueskyPostUri(candidate.uri) && typeof candidate.cid === 'string' && /^[a-zA-Z0-9]{1,256}$/.test(candidate.cid)
}

export function blueskyReplyParent(response: unknown, expectedUri: string): PublicReplyParent {
  const data = response as { posts?: Array<{ uri: string, cid: string, record?: { reply?: { root?: unknown } }, viewer?: { replyDisabled?: boolean } }> }
  const parent = Array.isArray(data?.posts) ? data.posts.find(post => post?.uri === expectedUri) : undefined
  if (!isBlueskyRef(parent)) throw new UserFacingError('Bluesky could not find the original post.')
  if (parent.viewer?.replyDisabled) throw new UserFacingError('The author has disabled replies to this Bluesky post.')
  const ref = { uri: parent.uri, cid: parent.cid }
  const root = parent.record?.reply === undefined ? ref : parent.record.reply?.root
  if (!isBlueskyRef(root)) throw new UserFacingError('Bluesky did not return the original conversation.')
  return { reply: { root: { uri: root.uri, cid: root.cid }, parent: ref } }
}

export function mastodonReplyParent(entry: MastodonNotification, expectedId: string, expectedUrl: string): PublicReplyParent {
  const notification = entry && mastodonNotification(entry)
  const status = entry?.status
  if (!notification || notification.remoteId !== expectedId || notification.url !== expectedUrl
    || typeof status?.id !== 'string' || !MASTODON_ID.test(status.id))
    throw new UserFacingError('Mastodon could not find the original public post.')
  const ref = { uri: status.id, cid: status.id }
  return { reply: { root: ref, parent: ref }, visibility: status.visibility === 'unlisted' ? 'unlisted' : 'public' }
}

export async function resolvePublicReply(provider: PublicInboxProvider, identityId: number, remoteId: string, originalUrl: string): Promise<PublicReplyParent> {
  if (provider === 'bluesky') {
    if (!isBlueskyPostUri(remoteId)) throw new UserFacingError('The original Bluesky post could not be identified.')
    return bluesky.withSession(async (identity) => {
      const server = await resolveBlueskyServer(identity.did || identity.handle)
      const url = new URL('/xrpc/app.bsky.feed.getPosts', server)
      url.searchParams.set('uris', remoteId)
      const { status, body } = await request(url, identity.accessToken!)
      if (status === 404) throw new UserFacingError('Bluesky could not find the original post.')
      if (status < 200 || status >= 300)
        throw new BlueskyApiError(`Bluesky returned HTTP ${status} while finding the original post.`, status, body)
      return blueskyReplyParent(JSON.parse(body), remoteId)
    }, identityId)
  }

  if (!MASTODON_ID.test(remoteId)) throw new UserFacingError('The original Mastodon notification could not be identified.')
  const identity = await mastodon.dmIdentity(identityId)
  const url = new URL(`/api/v1/notifications/${remoteId}`, identity.instance)
  const { status, body } = await request(url, identity.accessToken)
  if (status === 403) throw new UserFacingError('Reconnect Mastodon with a token that allows read:notifications.')
  if (status === 404) throw new UserFacingError('Mastodon could not find the original notification.')
  if (status < 200 || status >= 300) throw new UserFacingError(`Mastodon returned HTTP ${status} while finding the original post.`)
  return mastodonReplyParent(JSON.parse(body), remoteId, originalUrl)
}
