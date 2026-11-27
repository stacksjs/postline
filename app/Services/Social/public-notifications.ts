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
  status?: { url?: string | null, uri?: string, visibility?: string, content?: string, spoiler_text?: string, created_at?: string, in_reply_to_id?: string | null }
}

export function blueskyNotification(entry: BlueskyNotification): PublicNotification | undefined {
  if (entry.reason !== 'reply' && entry.reason !== 'mention') return
  const match = /^at:\/\/(did:[a-z]+:[\w.%:-]+)\/app\.bsky\.feed\.post\/([\w.~:-]+)$/.exec(entry.uri ?? '')
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
