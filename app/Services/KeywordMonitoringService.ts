import { db } from '@stacksjs/database'
import { alerts } from './AlertService'
import { isUsableIdentity } from '../Support/Social/accounts'
import { stripHtml } from '../Support/Social/text'
import { findIdentityRow } from './Social/identities'
import { ensureAccount, now, uuid } from './Social/support'
import { describeNetworkError } from '../Support/Social/network-errors'

const database = db as any

export const LISTENING_PROVIDERS = ['bluesky', 'twitter', 'mastodon'] as const
export const LISTENING_MATCH_MODES = ['any', 'all', 'phrase'] as const

type ListeningProvider = typeof LISTENING_PROVIDERS[number]
type MatchMode = typeof LISTENING_MATCH_MODES[number]

interface MentionCandidate {
  provider: ListeningProvider
  remoteUri: string
  url: string
  authorHandle: string
  authorName?: string | null
  body: string
  postedAt: string
}

export interface KeywordMonitorInput {
  name: string
  keywords: unknown
  providers: unknown
  matchMode?: string
  status?: string
}

function parseJsonList(value: unknown): string[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : []
  }
  catch {
    return String(value || '').split(',')
  }
}

export function normalizeKeywords(value: unknown): string[] {
  return [...new Set(parseJsonList(value)
    .map(keyword => keyword.trim().replace(/^['"]|['"]$/g, ''))
    .filter(keyword => keyword.length >= 2)
    .map(keyword => keyword.slice(0, 80)))]
    .slice(0, 20)
}

export function normalizeListeningProviders(value: unknown): ListeningProvider[] {
  const allowed = new Set<string>(LISTENING_PROVIDERS)
  return [...new Set(parseJsonList(value).map(provider => provider.trim().toLowerCase()).filter(provider => allowed.has(provider)))] as ListeningProvider[]
}

function monitorRow(row: any, unreadCount = 0, mentionCount = 0) {
  return {
    id: Number(row.id),
    name: String(row.name),
    keywords: normalizeKeywords(row.keywords),
    providers: normalizeListeningProviders(row.providers),
    matchMode: LISTENING_MATCH_MODES.includes(row.match_mode) ? row.match_mode : 'any',
    status: row.status === 'paused' ? 'paused' : 'active',
    lastCheckedAt: row.last_checked_at || null,
    lastError: row.last_error || null,
    unreadCount,
    mentionCount,
  }
}

function mentionRow(row: any) {
  return {
    id: Number(row.id),
    monitorId: Number(row.keyword_monitor_id),
    provider: String(row.provider),
    remoteUri: String(row.remote_uri),
    url: String(row.url),
    authorHandle: String(row.author_handle),
    authorName: row.author_name || null,
    body: String(row.body),
    matchedKeywords: normalizeKeywords(row.matched_keywords),
    status: row.status === 'read' ? 'read' : 'unread',
    postedAt: row.posted_at,
    createdAt: row.created_at,
  }
}

function sqliteTimestamp(value: unknown): string {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? now() : date.toISOString().slice(0, 19).replace('T', ' ')
}

function matchedKeywords(body: string, keywords: string[], mode: MatchMode): string[] {
  const haystack = body.toLocaleLowerCase()
  const found = keywords.filter(keyword => haystack.includes(keyword.toLocaleLowerCase()))
  if (mode === 'phrase') return haystack.includes(keywords.join(' ').toLocaleLowerCase()) ? keywords : []
  if (mode === 'all') return found.length === keywords.length ? found : []
  return found
}

async function fetchJson(url: URL, init: RequestInit = {}): Promise<any> {
  const headers = new Headers(init.headers)
  if (!headers.has('accept')) headers.set('accept', 'application/json')
  if (!headers.has('user-agent')) headers.set('user-agent', 'Postline/0.1 (+https://github.com/stacksjs/postline)')
  const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(12_000) })
  const text = await response.text()
  let payload: any = {}
  try {
    payload = text ? JSON.parse(text) : {}
  }
  catch {}
  if (!response.ok) {
    const plainText = response.headers.get('content-type')?.includes('application/json') ? text : ''
    throw new Error(payload?.detail || payload?.title || payload?.error || plainText.slice(0, 500) || `The network returned HTTP ${response.status}.`)
  }
  return payload
}

/**
 * The searches one rule takes on Bluesky. Its search has no `OR` (#132): `a OR
 * b` is matched as three words. So "any" is one search per keyword, merged;
 * "all" is the words together, which Bluesky reads as AND; a phrase is quoted.
 */
export function blueskyQueries(keywords: string[], mode: MatchMode): string[] {
  if (mode === 'phrase') return [`"${keywords.join(' ')}"`]
  if (mode === 'all') return [keywords.join(' ')]
  return keywords.map(keyword => (/\s/.test(keyword) ? `"${keyword}"` : keyword))
}

async function searchBluesky(keywords: string[], mode: MatchMode): Promise<MentionCandidate[]> {
  const seen = new Set<string>()
  const found: MentionCandidate[] = []
  for (const query of blueskyQueries(keywords, mode)) {
    for (const candidate of await searchBlueskyOnce(query, keywords, mode)) {
      if (seen.has(candidate.remoteUri)) continue
      seen.add(candidate.remoteUri)
      found.push(candidate)
    }
  }
  return found
}

async function searchBlueskyOnce(query: string, keywords: string[], mode: MatchMode): Promise<MentionCandidate[]> {
  const url = new URL('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts')
  url.searchParams.set('q', query)
  url.searchParams.set('sort', 'latest')
  url.searchParams.set('limit', '50')
  const payload = await fetchJson(url)

  return (payload.posts || []).flatMap((post: any) => {
    const body = String(post.record?.text || '')
    const uri = String(post.uri || '')
    const handle = String(post.author?.handle || '')
    if (!uri || !handle || !matchedKeywords(body, keywords, mode).length) return []
    return [{
      provider: 'bluesky' as const,
      remoteUri: uri,
      url: `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(uri.split('/').pop() || '')}`,
      authorHandle: handle,
      authorName: post.author?.displayName || null,
      body,
      postedAt: post.record?.createdAt || post.indexedAt || new Date().toISOString(),
    }]
  })
}

async function searchTwitter(keywords: string[], mode: MatchMode): Promise<MentionCandidate[]> {
  const identity = await findIdentityRow<any>('twitter', undefined, isUsableIdentity)
  if (!isUsableIdentity(identity)) throw new Error('Connect X on Accounts to search recent posts.')

  const terms = mode === 'phrase'
    ? `"${keywords.join(' ')}"`
    : mode === 'all'
      ? keywords.map(keyword => `"${keyword}"`).join(' ')
      : `(${keywords.map(keyword => `"${keyword}"`).join(' OR ')})`
  const url = new URL('https://api.twitter.com/2/tweets/search/recent')
  url.searchParams.set('query', `${terms} -is:retweet`)
  url.searchParams.set('max_results', '50')
  url.searchParams.set('tweet.fields', 'created_at,author_id')
  url.searchParams.set('expansions', 'author_id')
  url.searchParams.set('user.fields', 'name,username')
  const payload = await fetchJson(url, { headers: { authorization: `Bearer ${identity.access_token}` } })
  const users = new Map((payload.includes?.users || []).map((user: any) => [String(user.id), user]))

  return (payload.data || []).flatMap((post: any) => {
    const body = String(post.text || '')
    const user: any = users.get(String(post.author_id))
    const handle = String(user?.username || 'i')
    if (!post.id || !matchedKeywords(body, keywords, mode).length) return []
    return [{
      provider: 'twitter' as const,
      remoteUri: String(post.id),
      url: `https://x.com/${encodeURIComponent(handle)}/status/${encodeURIComponent(String(post.id))}`,
      authorHandle: handle,
      authorName: user?.name || null,
      body,
      postedAt: post.created_at || new Date().toISOString(),
    }]
  })
}

async function searchMastodon(keywords: string[], mode: MatchMode): Promise<MentionCandidate[]> {
  const identity = await findIdentityRow<any>('mastodon', undefined, isUsableIdentity)
  if (!isUsableIdentity(identity) || !identity?.external_id) throw new Error('Connect Mastodon on Accounts to search public posts.')

  const url = new URL('/api/v2/search', String(identity.external_id))
  url.searchParams.set('q', mode === 'phrase' ? `"${keywords.join(' ')}"` : keywords.join(' '))
  url.searchParams.set('type', 'statuses')
  url.searchParams.set('resolve', 'false')
  url.searchParams.set('limit', '40')
  const payload = await fetchJson(url, { headers: { authorization: `Bearer ${identity.access_token}` } })

  return (payload.statuses || []).flatMap((post: any) => {
    const body = stripHtml(String(post.content || ''))
    if (!post.id || !matchedKeywords(body, keywords, mode).length) return []
    return [{
      provider: 'mastodon' as const,
      remoteUri: String(post.id),
      url: String(post.url || post.uri),
      authorHandle: String(post.account?.acct || post.account?.username || 'unknown'),
      authorName: post.account?.display_name || null,
      body,
      postedAt: post.created_at || new Date().toISOString(),
    }]
  })
}

/** Mentions per page in Listening (#105). */
export const MENTION_PAGE = 50

export class KeywordMonitoringService {
  async list(monitorId = 0, offset = 0) {
    const monitors = await database.selectFrom('keyword_monitors').selectAll().orderBy('updated_at', 'desc').execute()
    // A page at a time, one more than shown to know whether another follows.
    // It stopped at 200 mentions and said nothing of the rest (#105).
    const start = Math.max(0, Math.floor(Number(offset) || 0))
    let mentionsQuery = database.selectFrom('keyword_mentions').selectAll()
    if (monitorId) mentionsQuery = mentionsQuery.where('keyword_monitor_id', '=', monitorId)
    const fetched = await mentionsQuery.orderBy('posted_at', 'desc').orderBy('id', 'desc').limit(MENTION_PAGE + 1).offset(start).execute()

    // Counts for every rule, read as two columns rather than every row in full.
    const counts = await database.selectFrom('keyword_mentions').select(['keyword_monitor_id', 'status']).execute()
    const monitorViews = monitors.map((monitor: any) => {
      const owned = counts.filter((mention: any) => Number(mention.keyword_monitor_id) === Number(monitor.id))
      return monitorRow(monitor, owned.filter((mention: any) => mention.status === 'unread').length, owned.length)
    })

    return {
      monitors: monitorViews,
      mentions: fetched.slice(0, MENTION_PAGE).map(mentionRow),
      nextOffset: fetched.length > MENTION_PAGE ? start + MENTION_PAGE : null,
      unreadCount: counts.filter((mention: any) => mention.status === 'unread').length,
    }
  }

  async save(id: number, input: KeywordMonitorInput) {
    const name = input.name.trim()
    const keywords = normalizeKeywords(input.keywords)
    const providers = normalizeListeningProviders(input.providers)
    const matchMode = LISTENING_MATCH_MODES.includes(input.matchMode as MatchMode) ? input.matchMode as MatchMode : 'any'
    const status = input.status === 'paused' ? 'paused' : 'active'
    if (name.length < 2) throw new Error('Give this listening rule a name.')
    if (!keywords.length) throw new Error('Add at least one keyword with two or more characters.')
    if (!providers.length) throw new Error('Choose at least one network to watch.')

    const values = {
      name,
      keywords: JSON.stringify(keywords),
      providers: JSON.stringify(providers),
      match_mode: matchMode,
      status,
      updated_at: now(),
    }

    if (id) {
      const existing = await database.selectFrom('keyword_monitors').selectAll().where('id', '=', id).executeTakeFirst()
      if (!existing) throw new Error('Listening rule not found.')
      await database.updateTable('keyword_monitors').set(values).where('id', '=', id).execute()
      return monitorRow(await database.selectFrom('keyword_monitors').selectAll().where('id', '=', id).executeTakeFirstOrThrow())
    }

    const monitorUuid = uuid()
    await database.insertInto('keyword_monitors').values({
      ...values,
      uuid: monitorUuid,
      account_id: await ensureAccount(),
      last_checked_at: null,
      last_error: null,
      created_at: now(),
    }).execute()
    return monitorRow(await database.selectFrom('keyword_monitors').selectAll().where('uuid', '=', monitorUuid).executeTakeFirstOrThrow())
  }

  async remove(id: number): Promise<void> {
    const existing = await database.selectFrom('keyword_monitors').select(['id']).where('id', '=', id).executeTakeFirst()
    if (!existing) throw new Error('Listening rule not found.')
    await database.deleteFrom('keyword_mentions').where('keyword_monitor_id', '=', id).execute()
    await database.deleteFrom('keyword_monitors').where('id', '=', id).execute()
  }

  async markRead(id = 0, monitorId = 0): Promise<number> {
    let query = database.updateTable('keyword_mentions').set({ status: 'read', updated_at: now() }).where('status', '=', 'unread')
    if (id) query = query.where('id', '=', id)
    if (monitorId) query = query.where('keyword_monitor_id', '=', monitorId)
    const result = await query.executeTakeFirst()
    return Number(result?.numUpdatedRows || 0)
  }

  async scan(monitorId = 0) {
    let query = database.selectFrom('keyword_monitors').selectAll().where('status', '=', 'active')
    if (monitorId) query = query.where('id', '=', monitorId)
    const monitors = await query.execute()
    let found = 0
    let created = 0
    const errors: Array<{ monitorId: number, provider: string, message: string }> = []

    for (const monitor of monitors) {
      const keywords = normalizeKeywords(monitor.keywords)
      const providers = normalizeListeningProviders(monitor.providers)
      const mode = LISTENING_MATCH_MODES.includes(monitor.match_mode) ? monitor.match_mode as MatchMode : 'any'
      const candidates: MentionCandidate[] = []

      for (const provider of providers) {
        try {
          const results = provider === 'bluesky'
            ? await searchBluesky(keywords, mode)
            : provider === 'twitter'
              ? await searchTwitter(keywords, mode)
              : await searchMastodon(keywords, mode)
          candidates.push(...results)
        }
        catch (error) {
          errors.push({ monitorId: Number(monitor.id), provider, message: describeNetworkError(provider, error, 'search') })
        }
      }

      const fresh: MentionCandidate[] = []
      for (const candidate of candidates) {
        found++
        const existing = await database.selectFrom('keyword_mentions').select(['id']).where('keyword_monitor_id', '=', monitor.id).where('provider', '=', candidate.provider).where('remote_uri', '=', candidate.remoteUri).executeTakeFirst()
        if (existing) continue
        await database.insertInto('keyword_mentions').values({
          uuid: uuid(),
          keyword_monitor_id: monitor.id,
          provider: candidate.provider,
          remote_uri: candidate.remoteUri,
          url: candidate.url,
          author_handle: candidate.authorHandle,
          author_name: candidate.authorName || null,
          body: candidate.body.slice(0, 10000),
          matched_keywords: JSON.stringify(matchedKeywords(candidate.body, keywords, mode)),
          status: 'unread',
          posted_at: sqliteTimestamp(candidate.postedAt),
          created_at: now(),
          updated_at: now(),
        }).execute()
        created++
        fresh.push(candidate)
      }

      // One alert per scan that found something, not one per mention: a busy
      // keyword should not bury the owner (#112).
      if (fresh.length) {
        const name = String(monitor.name || keywords.join(', ')).slice(0, 80)
        const first = fresh[0]!
        await alerts.raise({
          kind: 'keyword-match',
          title: fresh.length === 1 ? `New mention of ${name}` : `${fresh.length} new mentions of ${name}`,
          body: `@${first.authorHandle}: ${first.body}`.slice(0, 280),
          link: '/listening',
          key: `keyword:${monitor.id}:${first.provider}:${first.remoteUri}`,
        })
      }

      const monitorErrors = errors.filter(error => error.monitorId === Number(monitor.id))
      await database.updateTable('keyword_monitors').set({
        last_checked_at: now(),
        last_error: monitorErrors.length ? monitorErrors.map(error => `${error.provider}: ${error.message}`).join('\n').slice(0, 2000) : null,
        updated_at: now(),
      }).where('id', '=', monitor.id).execute()
    }

    return { scanned: monitors.length, found, created, errors }
  }
}

export const keywordMonitoring = new KeywordMonitoringService()
