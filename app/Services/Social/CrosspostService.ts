import type { CrosspostTargetResult, PublishContent, SocialProvider } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { blog } from './BlogService'
import { bluesky } from './BlueskyService'
import { instagram } from './InstagramService'
import { linkedin } from './LinkedInService'
import { mastodon } from './MastodonService'
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
  mastodon,
  blog,
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

    const results = await this.publishExisting({ id: Number(post.id), body }, selected, content)

    const anyOk = results.some(result => result.ok)
    const finishedAt = now()
    await database.updateTable('posts').set({
      status: anyOk ? 'published' : 'failed',
      ...(anyOk ? { published_at: finishedAt } : {}),
      updated_at: finishedAt,
    }).where('id', '=', post.id).execute()

    return { postId: Number(post.id), results }
  }

  /**
   * Publish a multi-post thread. Each segment gets its own `posts` row
   * (grouped by `thread_key`). Providers that support reply chains
   * (Bluesky) receive root/parent refs so segments render as an actual
   * thread; other providers publish each segment independently.
   */
  async publishThread(
    texts: string[],
    providers: SocialProvider[],
    content?: PublishContent,
  ): Promise<{ postIds: number[], results: CrosspostTargetResult[] }> {
    const segments = texts.map(text => text.trim()).filter(Boolean)
    if (segments.length === 0) throw new Error('Post text is required.')

    const selected = providers.filter(provider => publishers[provider])
    if (selected.length === 0) {
      throw new Error('Select at least one connected provider to publish.')
    }

    const accountId = await ensureAccount()
    const threadKey = uuid()
    const postIds: number[] = []
    const results: CrosspostTargetResult[] = []
    // Per-provider chain refs; only populated for providers whose results
    // carry a cid (Bluesky).
    const chains = new Map<SocialProvider, { root: { uri: string, cid: string }, parent: { uri: string, cid: string } }>()

    for (const [index, body] of segments.entries()) {
      const postUuid = uuid()
      const createdAt = now()

      await database.insertInto('posts').values({
        uuid: postUuid,
        title: body.slice(0, 80),
        body,
        status: 'publishing',
        timezone: env.TZ || 'America/Los_Angeles',
        source: 'composer',
        thread_key: threadKey,
        account_id: accountId,
        created_at: createdAt,
        updated_at: createdAt,
      }).execute()

      const post = await database
        .selectFrom('posts')
        .selectAll()
        .where('uuid', '=', postUuid)
        .executeTakeFirstOrThrow()
      postIds.push(Number(post.id))

      const segmentResults: CrosspostTargetResult[] = []
      for (const provider of selected) {
        const publisher = publishers[provider]!
        const chain = chains.get(provider)
        // Link previews/media only make sense on the first segment.
        const segmentContent: PublishContent | undefined = index === 0
          ? content
          : chain ? { reply: chain } : undefined

        const result = await publisher.publishToPost({ id: Number(post.id), body }, segmentContent)
        segmentResults.push(result)

        if (result.ok && result.uri && result.cid) {
          const existing = chains.get(provider)
          chains.set(provider, {
            root: existing?.root || { uri: result.uri, cid: result.cid },
            parent: { uri: result.uri, cid: result.cid },
          })
        }
      }

      results.push(...segmentResults)
      const anyOk = segmentResults.some(result => result.ok)
      const finishedAt = now()
      await database.updateTable('posts').set({
        status: anyOk ? 'published' : 'failed',
        ...(anyOk ? { published_at: finishedAt } : {}),
        updated_at: finishedAt,
      }).where('id', '=', post.id).execute()
    }

    return { postIds, results }
  }

  /**
   * Publish an existing `posts` row to the given providers. Used by the
   * fresh-publish path above and by the queue when a scheduled or drafted
   * post is (re)published.
   */
  async publishExisting(
    post: { id: number, body: string },
    providers: SocialProvider[],
    content?: PublishContent,
  ): Promise<CrosspostTargetResult[]> {
    const results: CrosspostTargetResult[] = []
    for (const provider of providers) {
      const publisher = publishers[provider]
      if (!publisher) continue
      results.push(await publisher.publishToPost({ id: post.id, body: post.body }, content))
    }
    return results
  }
}

export const crosspost = new CrosspostService()
