import type { CrosspostTargetResult, PublishContent, SocialProvider } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { bluesky } from './BlueskyService'
import { instagram } from './InstagramService'
import { linkedin } from './LinkedInService'
import { threads } from './ThreadsService'
import { ensureAccount, now, uuid } from './support'

const database = db as any

interface ProviderPublisher {
  publishToPost: (post: { id: number, body: string }, content?: PublishContent) => Promise<CrosspostTargetResult>
}

// Each provider owns its own connection/token handling behind `publishToPost`.
const publishers: Partial<Record<SocialProvider, ProviderPublisher>> = {
  bluesky,
  linkedin,
  instagram,
  threads,
}

export function crosspostProviders(): SocialProvider[] {
  return Object.keys(publishers) as SocialProvider[]
}

export class CrosspostService {
  /**
   * Publish one piece of content to several providers at once. A single
   * `posts` row is created and each provider gets its own `post_targets` row.
   * Per-provider failures are isolated — one platform erroring never aborts
   * the others.
   */
  async publish(
    text: string,
    providers: SocialProvider[],
    content?: PublishContent,
  ): Promise<{ postId: number, results: CrosspostTargetResult[] }> {
    const body = text.trim()
    if (!body) throw new Error('Post text is required.')

    const selected = providers.filter(provider => publishers[provider])
    if (selected.length === 0) {
      throw new Error('Select at least one connected provider to publish.')
    }

    const accountId = await ensureAccount()
    const postUuid = uuid()
    const createdAt = now()

    await database.insertInto('posts').values({
      uuid: postUuid,
      title: body.slice(0, 80),
      body,
      status: 'publishing',
      timezone: env.TZ || 'America/Los_Angeles',
      source: 'composer',
      account_id: accountId,
      created_at: createdAt,
      updated_at: createdAt,
    }).execute()

    const post = await database
      .selectFrom('posts')
      .selectAll()
      .where('uuid', '=', postUuid)
      .executeTakeFirstOrThrow()

    const results: CrosspostTargetResult[] = []
    for (const provider of selected) {
      const publisher = publishers[provider]!
      results.push(await publisher.publishToPost({ id: Number(post.id), body }, content))
    }

    const anyOk = results.some(result => result.ok)
    const finishedAt = now()
    await database.updateTable('posts').set({
      status: anyOk ? 'published' : 'failed',
      ...(anyOk ? { published_at: finishedAt } : {}),
      updated_at: finishedAt,
    }).where('id', '=', post.id).execute()

    return { postId: Number(post.id), results }
  }
}

export const crosspost = new CrosspostService()
