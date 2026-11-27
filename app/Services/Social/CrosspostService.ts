import process from 'node:process'
import type { PublishTarget } from '../../Support/Social/targets'
import type { ThreadChain } from '../../Support/Social/threads'
import type { CrosspostTargetResult, PublishContent, SocialProvider } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { parseTarget, resolveTargets, targetKey } from '../../Support/Social/targets'
import { advanceChain, threadSegmentContent } from '../../Support/Social/threads'
import { resolveVariantBody } from '../../Support/Social/variants'
import { blog } from './BlogService'
import { bluesky } from './BlueskyService'
import { instagram } from './InstagramService'
import { linkedin } from './LinkedInService'
import { mastodon } from './MastodonService'
import { threads } from './ThreadsService'
import { twitter } from './TwitterService'
import { workspace } from '../WorkspaceService'
import { UserFacingError } from '../../Support/Http/user-error'
import { fitImage, suits } from '../../Support/Social/image-fit'
import { persistTempMedia, removeTempMedia } from '../../Support/Social/uploads'
import type { MediaShare } from '../../Support/Social/media-share'
import { openMediaShare } from '../../Support/Social/media-share'
import { MEDIA_RULES } from '../../Support/Social/media-rules'
import { sanitizePostOptions } from '../../Support/Social/post-options'
import { hydrateStoredContent, MissingMediaError, parseStoredContent } from '../../Support/Social/stored-content'
import { ensureAccount, now, uuid } from './support'

const database = db as any

export interface ProviderPublisher {
  /**
   * Publish through one account. `identityId` names a `social_identities` row;
   * omitted, the network's default account. The blog has no accounts and
   * ignores it.
   */
  publishToPost: (post: { id: number, body: string }, content?: PublishContent, identityId?: number | null) => Promise<CrosspostTargetResult>
  /** The account a bare network target means right now, or null if none is connected. */
  defaultIdentityId?: () => Promise<number | null>
}

/** A target as callers may hand it over: a bare network name, a spec string, or parsed. */
export type TargetInput = SocialProvider | PublishTarget | string

// Each provider owns its own connection/token handling behind `publishToPost`.
const publishers: Partial<Record<SocialProvider, ProviderPublisher>> = {
  // This is also the order the composer renders its checkboxes in.
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

/** Whether the owner allowed temporary image links, in Settings or with POSTLINE_MEDIA_TUNNEL=1. */
async function mediaSharingAllowed(): Promise<boolean> {
  if (['1', 'true', 'on'].includes(String(process.env.POSTLINE_MEDIA_TUNNEL || '').toLowerCase())) return true
  try {
    return (await workspace.profile()).shareMediaByTunnel
  }
  catch {
    return false
  }
}

const NETWORK_NAMES: Record<string, string> = { bluesky: 'Bluesky', twitter: 'X', mastodon: 'Mastodon', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads' }

/** Networks that fetch an image from an address rather than taking its bytes. */
const FETCHES_BY_ADDRESS = new Set(['instagram', 'threads'])

/**
 * The content with its images fitted to one network. Only images whose bytes
 * are in hand can be converted; one given by address is passed on as it is.
 *
 * A converted image no longer matches the address of the original. For a
 * network that fetches by address it is written as a temporary file with an
 * address of its own; `tempFiles` lists them for removal once the network
 * has taken the post.
 */
async function fitContentFor(provider: string, content: PublishContent | undefined): Promise<{ content: PublishContent | undefined, tempFiles: string[] }> {
  const rule = MEDIA_RULES[provider]
  const tempFiles: string[] = []
  if (!rule || !content?.media?.length) return { content, tempFiles }
  if (content.media.every(item => !item.bytes?.length || suits({ bytes: item.bytes, mimeType: item.mimeType || '' }, rule))) return { content, tempFiles }

  const media: NonNullable<PublishContent['media']> = []
  for (const item of content.media) {
    if (!item.bytes?.length) {
      media.push(item)
      continue
    }
    const fitted = await fitImage({ bytes: item.bytes, mimeType: item.mimeType || '' }, rule, NETWORK_NAMES[provider] || provider)
    if (!fitted.changed) {
      media.push(item)
      continue
    }
    let url: string | undefined
    if (FETCHES_BY_ADDRESS.has(provider)) {
      const temp = await persistTempMedia(fitted.bytes, fitted.mimeType)
      if (temp) {
        tempFiles.push(temp.filename)
        url = temp.url
      }
    }
    media.push({ bytes: fitted.bytes, mimeType: fitted.mimeType, altText: item.altText, ...(url ? { url } : {}) })
  }
  return { content: { ...content, media }, tempFiles }
}

export class CrosspostService {
  /**
   * The publisher registry is injectable so tests can drive target resolution,
   * de-duplication and per-account thread chains without touching a network.
   */
  constructor(
    private registry: Partial<Record<SocialProvider, ProviderPublisher>> = publishers,
    private readonly shareMedia: typeof openMediaShare = openMediaShare,
    private readonly mayShareMedia: () => Promise<boolean> = mediaSharingAllowed,
  ) {}

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
      timezone: await workspace.timezone(),
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
   *
   * A segment that fails on an account stops the thread on that account.
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
    const chains = new Map<string, ThreadChain>()
    // The segment each target stopped at. Once a segment fails on an account,
    // nothing after it is sent there: the rest would arrive as a thread with
    // a hole in it, or as unrelated posts. Other accounts carry on.
    const halted = new Map<string, number>()

    for (const [index, body] of segments.entries()) {
      const postUuid = uuid()
      const createdAt = now()

      await database.insertInto('posts').values({
        uuid: postUuid,
        title: body.slice(0, 80),
        body,
        status: 'publishing',
        timezone: await workspace.timezone(),
        source: 'composer',
        thread_key: threadKey,
        // The thread's language and content warning, so resuming it later
        // sends the rest the same way (resumeThread).
        ...(content?.options ? { content: JSON.stringify({ options: content.options }) } : {}),
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

        const stoppedAt = halted.get(key)
        if (stoppedAt !== undefined) {
          segmentResults.push(await this.recordHeldBack(target, Number(post.id), stoppedAt, segments.length))
          continue
        }

        const result = await this.publishTarget(
          target,
          { id: Number(post.id), body },
          threadSegmentContent(index, content, chain),
        )
        segmentResults.push(result)
        if (!result.ok)
          halted.set(key, index)

        // A provider that returns no cid cannot be replied to, so its chain
        // stays undefined and its segments publish independently.
        const advanced = advanceChain(chain, result)
        if (advanced) chains.set(key, advanced)
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
   * Carry on a thread from where it stopped (#100).
   *
   * For each account the thread went to, the first segment that did not go
   * out is sent again as a reply to the last one that did, and the rest
   * follow, with the same rule as the first run: a failure stops that
   * account there. Accounts that already have every segment are left alone.
   */
  async resumeThread(threadKey: string): Promise<{ resumed: number, results: CrosspostTargetResult[] }> {
    const posts = await database.selectFrom('posts').selectAll().where('thread_key', '=', threadKey)
      .where('status', '!=', 'archived').orderBy('id', 'asc').execute()
    if (!posts.length) throw new UserFacingError('That thread is not in the queue any more.')

    const rows = await database.selectFrom('post_targets').selectAll().where('post_id', 'in', posts.map((post: any) => post.id)).execute()
    const keyOf = (row: any) => targetKey({ provider: row.provider, identityId: row.social_identity_id ? Number(row.social_identity_id) : null })
    const targets = new Map<string, PublishTarget>()
    for (const row of rows) targets.set(keyOf(row), { provider: row.provider, identityId: row.social_identity_id ? Number(row.social_identity_id) : null })

    const options = sanitizePostOptions(parseStoredContent(posts[0].content)?.options)
    let lead: Promise<PublishContent | undefined> | undefined

    const results: CrosspostTargetResult[] = []
    let resumed = 0
    for (const [key, target] of targets) {
      const forTarget = (postId: number) => rows.filter((row: any) => Number(row.post_id) === postId && keyOf(row) === key)
      const start = posts.findIndex((post: any) => !forTarget(Number(post.id)).some((row: any) => row.status === 'published'))
      if (start === -1) continue
      resumed++

      // The chain so far: the first segment as root, the last sent as parent.
      let chain: ThreadChain | undefined
      for (const post of posts.slice(0, start)) {
        const sent = forTarget(Number(post.id)).find((row: any) => row.status === 'published')
        if (sent?.remote_uri && sent?.remote_cid)
          chain = advanceChain(chain, { ok: true, uri: String(sent.remote_uri), cid: String(sent.remote_cid) })
      }

      let halted: number | undefined
      for (const [index, post] of posts.entries()) {
        if (index < start || forTarget(Number(post.id)).some((row: any) => row.status === 'published')) continue
        // The failed and held-back rows from before give way to this attempt.
        let stale = database.deleteFrom('post_targets').where('post_id', '=', post.id).where('status', '!=', 'published').where('provider', '=', target.provider)
        stale = target.identityId ? stale.where('social_identity_id', '=', target.identityId) : stale.where('social_identity_id', 'is', null)
        await stale.execute()
        if (halted !== undefined) {
          results.push(await this.recordHeldBack(target, Number(post.id), halted, posts.length))
          continue
        }
        const publishingPost = { id: Number(post.id), body: String(post.body) }
        let result: CrosspostTargetResult
        try {
          const content = index === 0
            ? await (lead ??= hydrateStoredContent(post.content))
            : options ? { options } : undefined
          result = await this.publishTarget(target, publishingPost, threadSegmentContent(index, content, chain))
        }
        catch (error) {
          if (!(error instanceof MissingMediaError)) throw error
          result = await this.recordThreadFailure(target, publishingPost.id, error.message)
        }
        results.push(result)
        if (!result.ok) halted = index
        const advanced = advanceChain(chain, result)
        if (advanced) chain = advanced
        if (result.ok) {
          await database.updateTable('posts').set({ status: 'published', published_at: now(), updated_at: now() }).where('id', '=', post.id).execute()
        }
      }
    }

    return { resumed, results }
  }

  /**
   * Record a thread segment that was not sent because an earlier one failed
   * on the same account, so the queue shows it and says why.
   */
  private async recordHeldBack(
    target: PublishTarget,
    postId: number,
    failedIndex: number,
    total: number,
  ): Promise<CrosspostTargetResult> {
    return this.recordThreadFailure(target, postId, `Not sent: post ${failedIndex + 1} of ${total} in this thread failed here, so the rest were held back.`)
  }

  private async recordThreadFailure(target: PublishTarget, postId: number, error: string): Promise<CrosspostTargetResult> {
    const at = now()
    await database.insertInto('post_targets').values({
      uuid: uuid(),
      provider: target.provider,
      social_identity_id: target.identityId || null,
      status: 'failed',
      failure_reason: error,
      post_id: postId,
      created_at: at,
      updated_at: at,
    }).execute()

    return { provider: target.provider, ok: false, error, target: targetKey(target), identityId: target.identityId ?? undefined } as CrosspostTargetResult
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
   * Give every image a public address for a network that fetches by address,
   * through a temporary link, or say why that cannot happen and what fixes it.
   */
  private async reachableMedia(provider: string, content: PublishContent): Promise<{ ok: true, content: PublishContent, share: MediaShare } | { ok: false, error: string }> {
    const name = NETWORK_NAMES[provider] || provider
    const media = content.media ?? []
    if (media.some(item => !item.url && !item.bytes?.length))
      return { ok: false, error: `${name} could not be sent an image: it has neither a file nor an address.` }
    if (!(await this.mayShareMedia())) {
      return {
        ok: false,
        error: `${name} fetches images from an address on the internet, and this Postline has none. Turn on "Share images through a temporary link" in Settings, General, or give Postline a public web address (the self-hosting guide shows how).`,
      }
    }

    const needing = media.filter(item => !item.url)
    let share: MediaShare
    try {
      share = await this.shareMedia(needing.map(item => ({ bytes: item.bytes!, mimeType: item.mimeType || 'image/jpeg' })))
    }
    catch (error) {
      return { ok: false, error: `${error instanceof Error ? error.message : String(error)} Try again, or give Postline a public web address (the self-hosting guide shows how).` }
    }
    let next = 0
    return {
      ok: true,
      share,
      content: { ...content, media: media.map(item => item.url ? item : { ...item, url: share.urls[next++] }) },
    }
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

    // Each network gets the images the way it takes them: converted where
    // its format or size limit needs it, untouched where it does not.
    let fitted: Awaited<ReturnType<typeof fitContentFor>>
    try {
      fitted = await fitContentFor(target.provider, content)
    }
    catch (error) {
      return { provider: target.provider, ok: false, error: error instanceof Error ? error.message : String(error), target: targetKey(target), identityId: target.identityId ?? undefined }
    }

    // Instagram and Threads fetch each image from an address. Without one
    // they cannot be sent an image at all, so either a temporary link is
    // opened (when the owner allowed it) or the post is refused with the fix.
    let share: MediaShare | undefined
    if (FETCHES_BY_ADDRESS.has(target.provider) && fitted.content?.media?.some(item => !item.url)) {
      const reachable = await this.reachableMedia(target.provider, fitted.content)
      if (!reachable.ok) {
        for (const file of fitted.tempFiles) await removeTempMedia(file)
        return { provider: target.provider, ok: false, error: reachable.error, target: targetKey(target), identityId: target.identityId ?? undefined, retry: { kind: 'permanent' } }
      }
      fitted.content = reachable.content
      share = reachable.share
    }

    let result: CrosspostTargetResult
    const startedMs = Date.now()
    try {
      result = await publisher.publishToPost(post, fitted.content, target.identityId)
    }
    catch (error) {
      // A publisher is meant to return its failures, not throw them. One that
      // throws is recorded the same way, so the post shows why it failed.
      result = { provider: target.provider, ok: false, error: error instanceof Error ? error.message : String(error), identityId: target.identityId ?? undefined }
    }
    finally {
      // The network fetches the image while the post is created, so the
      // converted copies and the temporary link are done with once it answers.
      for (const file of fitted.tempFiles) await removeTempMedia(file)
      await share?.close()
    }
    const identityId = result.identityId ?? target.identityId ?? undefined
    // One line per network call: which post, where, how it ended and how long it took.
    const line = `[postline] publish post=${post.id} target=${targetKey({ provider: result.provider, identityId: identityId ?? null })} ok=${result.ok} ms=${Date.now() - startedMs}${result.ok ? '' : ` error=${JSON.stringify(String(result.error || '').slice(0, 300))}`}`
    if (result.ok) log.info(line)
    else log.warn(line)
    return {
      ...result,
      ...(identityId ? { identityId } : {}),
      target: targetKey({ provider: result.provider, identityId: identityId ?? null }),
    }
  }
}

export const crosspost = new CrosspostService()
