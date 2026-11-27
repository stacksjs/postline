import type { FirstCommentOutcome } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { SocialApiError } from '@stacksjs/socials'
import { UserFacingError } from '../../Support/Http/user-error'
import { explainNetworkError } from '../../Support/Social/network-errors'
import { FIRST_COMMENT_PROVIDERS } from '../../Support/Social/post-options'
import { instagram } from './InstagramService'
import { linkedin } from './LinkedInService'
import { now } from './support'

const database = db as any
const UNCERTAIN = 'The network did not confirm the first comment. Open the published post and check its comments.'
const STALE_ATTEMPT_MS = 2 * 60_000

export class PostFirstCommentService {
  async send(targetId: number, retry = false): Promise<FirstCommentOutcome | undefined> {
    const startedAt = now()
    const target = await database.updateTable('post_targets').set({
      first_comment_status: 'sending', first_comment_started_at: startedAt, first_comment_error: null,
    }).where('id', '=', targetId).where('status', '=', 'published')
      .where('provider', 'in', [...FIRST_COMMENT_PROVIDERS])
      .where('first_comment_status', '=', retry ? 'failed' : 'pending')
      .returningAll().executeTakeFirst()
    if (!target) return undefined

    const provider = target.provider === 'linkedin' ? linkedin : instagram
    let outcome: FirstCommentOutcome
    try {
      if (!target.social_identity_id || !target.remote_uri || !target.first_comment_body)
        throw new UserFacingError('The published post or its account could not be found.')

      const remoteId = await provider.publishFirstComment(Number(target.social_identity_id), target.remote_uri, target.first_comment_body)
      // A 2xx response records delivery even if the network omitted the ID.
      outcome = { status: 'sent', remoteId }
    }
    catch (error) {
      const refused = error instanceof UserFacingError
        || (error instanceof SocialApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 409)
      outcome = refused
        ? { status: 'failed', error: error instanceof UserFacingError ? error.message : explainNetworkError(target.provider, error, 'comment').message }
        : { status: 'uncertain', error: UNCERTAIN }
    }

    await database.updateTable('post_targets').set({
      first_comment_status: outcome.status,
      first_comment_error: outcome.error || null,
      first_comment_remote_id: outcome.remoteId || null,
    }).where('id', '=', targetId).where('first_comment_status', '=', 'sending')
      .where('first_comment_started_at', '=', startedAt).execute()
    return outcome
  }

  /** Resume never-attempted comments after a restart. A lost acknowledgement
   * requires review because neither comments API offers an idempotency key. */
  async recoverPending(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_ATTEMPT_MS).toISOString().slice(0, 19).replace('T', ' ')
    await database.updateTable('post_targets').set({ first_comment_status: 'uncertain', first_comment_error: UNCERTAIN })
      .where('first_comment_status', '=', 'sending').where('first_comment_started_at', '<=', cutoff).execute()

    const pending: Array<{ id: number }> = await database.selectFrom('post_targets').select(['id'])
      .where('status', '=', 'published').where('first_comment_status', '=', 'pending')
      .orderBy('id', 'asc').limit(10).execute()
    for (const row of pending) {
      try {
        await this.send(row.id)
      }
      catch {
        await log.warn(`[postline] could not record first comment for target ${row.id}`)
      }
    }
  }
}

export const postFirstComments = new PostFirstCommentService()
