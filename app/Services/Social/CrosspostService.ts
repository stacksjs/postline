import type { PublishTarget } from '../../Support/Social/targets'
import type { CrosspostTargetResult, PublishContent, SocialProvider } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { parseTarget, resolveTargets, targetKey } from '../../Support/Social/targets'
import { resolveVariantBody } from '../../Support/Social/variants'
import { blog } from './BlogService'
import { bluesky } from './BlueskyService'
import { instagram } from './InstagramService'
import { linkedin } from './LinkedInService'
import { mastodon } from './MastodonService'
import { opentimes } from './OpenTimesService'
import { threads } from './ThreadsService'
import { twitter } from './TwitterService'
import { ensureAccount, now, uuid } from './support'

const database = db as any

export interface ProviderPublisher {
  /**
   * Publish through one account. `identityId` names a `social_identities` row;
   * omitted, the network's default account. Our own targets (blog, The Open
   * Times) have no accounts and ignore it.
   */
  publishToPost: (post: { id: number, body: string }, content?: PublishContent, identityId?: number | null) => Promise<CrosspostTargetResult>
  /** The account a bare network target means right now, or null if none is connected. */
  defaultIdentityId?: () => Promise<number | null>
}

/** A target as callers may hand it over: a bare network name, a spec string, or parsed. */
export type TargetInput = SocialProvider | PublishTarget | string

// Each provider owns its own connection/token handling behind `publishToPost`.
const publishers: Partial<Record<SocialProvider, ProviderPublisher>> = {
  // Ours first: it is the one target that is always connected, so listing it
  // first is also the order the composer renders its checkboxes in.
  opentimes,
  bluesky,
  twitter,
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
   * The publisher registry is injectable so tests can drive target resolution,
   * de-duplication and per-account thread chains without touching a network.
   */
  constructor(private registry: Partial<Record<SocialProvider, ProviderPublisher>> = publishers) {}

  /**
   * Normalise whatever the caller passed into concrete, de-duplicated targets.
   *
   * Bare network names are pinned to that network's default account here, at
   * publish time, rather than when a post was queued — and then de-duplicated
   * again, so `bluesky` alongside `bluesky:12` (12 being the default) posts
   * once, while `bluesky:12` alongside `bluesky:13` posts twice. That second
   * case is the point: de-dup is per account, never per network.
   */
  async resolve(targets: readonly TargetInput[]): Promise<PublishTarget[]> {
    const parsed = targets
      .map(target => parseTarget(target, Object.keys(this.registry)))
      .filter((target): target is PublishTarget => Boolean(target))

    const defaults: Partial<Record<SocialProvider, number | null>> = {}
    for (const target of parsed) {
      if (target.identityId || target.provider in defaults) continue
      const lookup = this.registry[target.provider]?.defaultIdentityId
      defaults[target.provider] = lookup ? await lookup().catch(() => null) : null
    }

    return resolveTargets(parsed, defaults)
  }

  /**
   * Publish one piece of content to several targets at once. A single
   * `posts` row is created and each target gets its own `post_targets` row.
   * Per-target failures are isolated — one platform (or one account) erroring
   * never aborts the others.
   */
  async publish(
    text: string,
    targets: readonly TargetInput[],
    content?: PublishContent,
  ): Promise<{ postId: number, results: CrosspostTargetResult[] }> {
    const body = text.trim()
    if (!body) throw new Error('Post text is required.')

    const selected = await this.resolve(targets)
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
    targets: readonly TargetInput[],
    content?: PublishContent,
  ): Promise<{ postIds: number[], results: CrosspostTargetResult[] }> {
    const segments = texts.map(text => text.trim()).filter(Boolean)
    if (segments.length === 0) throw new Error('Post text is required.')

    const selected = await this.resolve(targets)
    if (selected.length === 0) {
      throw new Error('Select at least one connected provider to publish.')
    }

    const accountId = await ensureAccount()
    const threadKey = uuid()
    const postIds: number[] = []
    const results: CrosspostTargetResult[] = []
    // Chain refs per target, not per provider: two Bluesky accounts each get
    // their own thread, and segment 2 on one must never reply to segment 1 on
    // the other. Only populated for results that carry a cid (Bluesky).
    const chains = new Map<string, { root: { uri: string, cid: string }, parent: { uri: string, cid: string } }>()

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
      for (const target of selected) {
        const key = targetKey(target)
        const chain = chains.get(key)
        // Link previews/media only make sense on the first segment.
        //
        // Variants are deliberately stripped: it is ambiguous whether an
        // override should replace the first segment or the whole chain, so a
        // thread always publishes its shared segments. Dropping the field here
        // makes that a decision rather than an accident of drivers ignoring it.
        const segmentContent: PublishContent | undefined = index === 0
          ? content ? { ...content, variants: undefined } : undefined
          : chain ? { reply: chain } : undefined

        const result = await this.publishTarget(target, { id: Number(post.id), body }, segmentContent)
        segmentResults.push(result)

        if (result.ok && result.uri && result.cid) {
          const existing = chains.get(key)
          chains.set(key, {
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
   * Publish an existing `posts` row to the given targets. Used by the
   * fresh-publish path above and by the queue when a scheduled or drafted
   * post is (re)published.
   *
   * Variants stay per network: two Bluesky accounts publish the same Bluesky
   * override, because the override exists for the network's limits, not for
   * the account.
   */
  async publishExisting(
    post: { id: number, body: string },
    targets: readonly TargetInput[],
    content?: PublishContent,
  ): Promise<CrosspostTargetResult[]> {
    const results: CrosspostTargetResult[] = []
    for (const target of await this.resolve(targets)) {
      const body = resolveVariantBody(post.body, target.provider, content)
      results.push(await this.publishTarget(target, { id: post.id, body }, content))
    }
    return results
  }

  /**
   * One target, one result — labelled with the account it was meant for even
   * when the publisher failed before resolving one, so callers can match each
   * result back to the target that produced it.
   */
  private async publishTarget(
    target: PublishTarget,
    post: { id: number, body: string },
    content?: PublishContent,
  ): Promise<CrosspostTargetResult> {
    const publisher = this.registry[target.provider]
    if (!publisher) {
      return { provider: target.provider, ok: false, error: 'This network is not available.', target: targetKey(target) }
    }

    const result = await publisher.publishToPost(post, content, target.identityId)
    const identityId = result.identityId ?? target.identityId ?? undefined
    return {
      ...result,
      ...(identityId ? { identityId } : {}),
      target: targetKey({ provider: result.provider, identityId: identityId ?? null }),
    }
  }
}

export const crosspost = new CrosspostService()
