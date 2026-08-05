/**
 * Postline as a publishing target.
 *
 * The short-form half of Discover. Publishing here writes a `discover_entries`
 * row instead of calling an external API, exactly as `BlogService` writes a
 * post instead of calling one, so the composer, the queue, per-network
 * variants, scheduling and the metrics view all treat it as one more network
 * with no special-casing anywhere.
 *
 * It never throws, for the same reason the other providers do not: a failure
 * here is recorded on the target and returned, so a post that also went to
 * Bluesky is not rolled back because our own feed had a problem.
 */

import type { CrosspostTargetResult, PublishContent } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { discover } from '../DiscoverService'
import { publications } from '../PublicationService'
import { now, uuid } from './support'

const database = db as any

/**
 * Short form is short on purpose. It is the length of a post that travels
 * next to a Bluesky or Mastodon one, not an essay, and the long-form target
 * already exists for anything bigger.
 */
const CHARACTER_LIMIT = 2000

export class PostlineService {
  async status(): Promise<{ provider: 'postline', handle: string, canPublish: boolean, characterLimit: number, listed: boolean }> {
    const publication = await publications.ensurePublication()

    return {
      provider: 'postline',
      handle: publication.name,
      // Always publishable. An unlisted publication still records the post
      // against itself; it simply does not appear in anyone else's feed until
      // the publication is listed, which is the owner's decision to make later
      // without losing the posts made before it.
      canPublish: true,
      characterLimit: CHARACTER_LIMIT,
      listed: publication.listed,
    }
  }

  async publishToPost(
    post: { id: number, body: string },
    _content?: PublishContent,
  ): Promise<CrosspostTargetResult> {
    const targetUuid = uuid()
    const createdAt = now()

    await database.insertInto('post_targets').values({
      uuid: targetUuid,
      provider: 'postline',
      status: 'publishing',
      post_id: post.id,
      created_at: createdAt,
      updated_at: createdAt,
    }).execute()

    const target = await database
      .selectFrom('post_targets')
      .selectAll()
      .where('uuid', '=', targetUuid)
      .executeTakeFirstOrThrow()

    try {
      if (post.body.length > CHARACTER_LIMIT)
        throw new Error(`Postline short posts must be ${CHARACTER_LIMIT} characters or fewer. Publish it to your blog instead.`)

      const publication = await publications.ensurePublication()
      const entry = await discover.record({
        form: 'short',
        // Keyed on the post row, so republishing the same post updates its
        // entry rather than posting it to the feed a second time.
        sourceKey: `post:${post.id}`,
        body: post.body,
        postId: post.id,
        publishedAt: now(),
      })

      const url = entry ? `/discover?entry=${entry.id}` : null
      await database.updateTable('post_targets').set({
        status: 'published',
        remote_uri: entry ? `postline:${entry.id}` : `postline:unlisted:${post.id}`,
        failure_reason: null,
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return {
        provider: 'postline',
        ok: true,
        // An unlisted publication publishes successfully and links nowhere,
        // because there is no public feed page for it to link to yet.
        url: url || undefined,
        uri: `postline:${entry?.id ?? publication.id}`,
        targetId: Number(target.id),
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await database.updateTable('post_targets').set({
        status: 'failed',
        failure_reason: message.slice(0, 1000),
        updated_at: now(),
      }).where('id', '=', target.id).execute()

      return { provider: 'postline', ok: false, error: message, targetId: Number(target.id) }
    }
  }
}

export const postline = new PostlineService()
