/**
 * What Postline has done: each send to a network, with its outcome, and each
 * recurring job, with when it last ran.
 *
 * Nothing is recorded for this view: it reads the results ledger
 * (`post_targets`) and the job heartbeats, which already hold it. Every send
 * writes a fresh target row, so their ids are in the order things happened
 * and a page can be cut by id.
 */
import type { Heartbeat, SchedulerState } from '../Support/heartbeat'
import { db } from '@stacksjs/database'
import { readHeartbeats, schedulerState } from '../Support/heartbeat'
import { targetKey } from '../Support/Social/targets'

const database = db as any

export const ACTIVITY_PAGE_SIZE = 50
const MAX_ACTIVITY_PAGE_SIZE = 200

export interface ActivityEvent {
  id: number
  kind: 'published' | 'failed'
  /** When it happened, as an ISO time. */
  at: string | null
  provider: string
  /** The account it went out through, when the network has accounts. */
  handle: string | null
  target: string
  postId: number
  /** The start of the post, to recognise it by. */
  excerpt: string
  /** Where it is on the network, when it is a web address. */
  url: string | null
  /** Why it failed, in the network's or Postline's words. */
  reason: string | null
  attempts: number
  /** When Postline sends it again by itself; null when it will not. */
  nextAttemptAt: string | null
}

function toIso(value: unknown): string | null {
  return value ? `${String(value).replace(' ', 'T')}Z` : null
}

function excerptOf(post: any): string {
  const text = String(post?.title && post.title !== String(post?.body || '').slice(0, 80) ? post.title : post?.body || '').replace(/\s+/g, ' ').trim()
  return text.length > 140 ? `${text.slice(0, 139)}…` : text
}

export class ActivityService {
  async feed(options: { before?: number | null, limit?: number, kind?: 'published' | 'failed' | null } = {}): Promise<{ events: ActivityEvent[], nextCursor: number | null }> {
    const limit = Math.min(MAX_ACTIVITY_PAGE_SIZE, Math.max(1, Math.floor(Number(options.limit) || ACTIVITY_PAGE_SIZE)))
    let query = database
      .selectFrom('post_targets')
      .selectAll()
      .where('status', 'in', options.kind ? [options.kind] : ['published', 'failed'])
    if (options.before) query = query.where('id', '<', Number(options.before))

    const fetched = await query.orderBy('id', 'desc').limit(limit + 1).execute()
    const rows = fetched.slice(0, limit)
    const nextCursor = fetched.length > limit ? Number(rows[rows.length - 1].id) : null
    if (rows.length === 0) return { events: [], nextCursor: null }

    const postIds = [...new Set(rows.map((row: any) => Number(row.post_id)).filter(Boolean))]
    const identityIds = [...new Set(rows.map((row: any) => Number(row.social_identity_id)).filter(Boolean))]
    const posts = postIds.length
      ? await database.selectFrom('posts').select(['id', 'title', 'body']).where('id', 'in', postIds).execute()
      : []
    const identities = identityIds.length
      ? await database.selectFrom('social_identities').select(['id', 'handle']).where('id', 'in', identityIds).execute()
      : []
    const postById = new Map<number, any>(posts.map((post: any) => [Number(post.id), post]))
    const handleById = new Map<number, string>(identities.map((row: any) => [Number(row.id), String(row.handle)]))

    const events = rows.map((row: any): ActivityEvent => {
      const identityId = Number(row.social_identity_id) || null
      const failed = String(row.status) === 'failed'
      const remote = String(row.remote_uri || '')
      return {
        id: Number(row.id),
        kind: failed ? 'failed' : 'published',
        at: toIso(row.updated_at || row.created_at),
        provider: String(row.provider),
        handle: identityId ? handleById.get(identityId) || null : null,
        target: targetKey({ provider: row.provider, identityId }),
        postId: Number(row.post_id),
        excerpt: excerptOf(postById.get(Number(row.post_id))),
        url: /^https?:\/\//.test(remote) ? remote : null,
        reason: failed ? String(row.failure_reason || 'No reason was given.') : null,
        attempts: Number(row.attempts) || 0,
        nextAttemptAt: failed ? toIso(row.next_attempt_at) : null,
      }
    })

    return { events, nextCursor }
  }

  async jobs(): Promise<{ scheduler: { state: SchedulerState, lastRunAt: string | null }, jobs: Heartbeat[] }> {
    const jobs = await readHeartbeats()
    return { scheduler: schedulerState(jobs), jobs }
  }
}

export const activity = new ActivityService()
