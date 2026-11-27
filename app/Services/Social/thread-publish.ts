import { db, sqliteWriteOptions } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { UserFacingError } from '../../Support/Http/user-error'
import { postWebhooks } from '../PostWebhookService'
import { now, uuid } from './support'

const database = db as any

export class AlreadyPublishingError extends UserFacingError {
  constructor() {
    super('This post is already being published.')
  }
}

export class ThreadRemovalPendingError extends UserFacingError {
  constructor() {
    super('Undo the removal or wait for it to expire before publishing this thread.', 'queue_thread_removal_pending')
  }
}

/** Someone can check the network before choosing whether to send again. */
export const STRANDED_REASON = 'Postline stopped while this was being sent. Check the network before retrying: it may have gone out.'

interface ThreadClaim {
  threadKey: string
  token: string
}

/** Refresh the claim before each send. A runner that lost it must stop. */
export async function refreshThreadClaim(claim: ThreadClaim): Promise<void> {
  const live = await database.updateTable('thread_publish_claims').set({ updated_at: now() })
    .where('thread_key', '=', claim.threadKey).where('uuid', '=', claim.token)
    .returning('id').executeTakeFirst()
  if (!live) throw new AlreadyPublishingError()
}

export function claimThread(tx: typeof database, threadKey: string): ThreadClaim {
  if (tx.selectFrom('thread_publish_claims').select('id').where('thread_key', '=', threadKey).executeTakeFirst())
    throw new AlreadyPublishingError()
  const claim = { threadKey, token: uuid() }
  const at = now()
  tx.insertInto('thread_publish_claims').values({ uuid: claim.token, thread_key: threadKey, created_at: at, updated_at: at }).execute()
  return claim
}

export async function runClaimedThread<T>(claim: ThreadClaim, run: () => Promise<T>): Promise<T> {
  // A long request can outlast the time between two segment writes.
  const heartbeat = setInterval(() => {
    void refreshThreadClaim(claim).catch(() => log.warn('[postline] Thread publishing claim heartbeat could not be refreshed.'))
  }, 60_000)
  heartbeat.unref()
  try {
    return await run()
  }
  finally {
    clearInterval(heartbeat)
    await database.transaction((tx: typeof database) => finishThreadClaim(tx, claim), sqliteWriteOptions())
  }
}

function finishThreadClaim(tx: typeof database, claim: ThreadClaim, cutoff?: string): number {
  let owner = tx.selectFrom('thread_publish_claims').select('id')
    .where('thread_key', '=', claim.threadKey).where('uuid', '=', claim.token)
  if (cutoff) owner = owner.where('updated_at', '<=', cutoff)
  const row = owner.executeTakeFirst()
  if (!row) return 0

  const posts: Array<{ id: number, status: string, published_at: string | null }> = tx.selectFrom('posts')
    .select(['id', 'status', 'published_at']).where('thread_key', '=', claim.threadKey).execute()
  const at = now()
  let recovered = 0
  for (const post of posts) {
    const targets: Array<{ id: number, provider: string, status: string, social_identity_id: number | null }> = tx.selectFrom('post_targets')
      .select(['id', 'provider', 'status', 'social_identity_id']).where('post_id', '=', post.id).orderBy('id', 'desc').execute()
    const key = (target: typeof targets[number]) => `${target.provider}:${target.social_identity_id ?? ''}`
    const published = targets.filter(target => target.status === 'published')
    const settled = new Set(published.map(key))
    const pending = targets.filter(target => target.status === 'publishing')
    for (const target of pending) {
      const address = key(target)
      if (settled.has(address)) {
        tx.deleteFrom('post_targets').where('id', '=', target.id).execute()
      }
      else {
        tx.updateTable('post_targets').set({
          status: 'failed', failure_reason: STRANDED_REASON, next_attempt_at: null, updated_at: at,
        }).where('id', '=', target.id).execute()
      }
      settled.add(address)
    }
    if (post.status === 'publishing') {
      const status = published.length ? 'published' : 'failed'
      tx.updateTable('posts').set({
        status,
        ...(published.length && !post.published_at && { published_at: at }),
        updated_at: at,
      }).where('id', '=', post.id).execute()
      postWebhooks.enqueue(tx, status === 'published' ? 'post.published' : 'post.failed', { postId: Number(post.id), status, reason: 'interrupted' })
    }
    if (pending.length || post.status === 'publishing') recovered += 1
  }

  tx.deleteFrom('thread_publish_claims').where('id', '=', row.id).execute()
  return recovered
}

/** Recover a stopped run before another attempt can claim its thread. */
export async function recoverThreadClaims(cutoff: string): Promise<number> {
  const abandoned: Array<{ thread_key: string, uuid: string }> = await database.selectFrom('thread_publish_claims')
    .select(['thread_key', 'uuid']).where('updated_at', '<=', cutoff).execute()
  let recovered = 0
  for (const row of abandoned) {
    recovered += await database.transaction((tx: typeof database) =>
      finishThreadClaim(tx, { threadKey: row.thread_key, token: row.uuid }, cutoff), sqliteWriteOptions())
  }
  return recovered
}
