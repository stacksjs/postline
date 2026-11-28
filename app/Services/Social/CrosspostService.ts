import process from 'node:process'
import type { StoredContent } from '../../Support/Social/stored-content'
import type { PublishTarget } from '../../Support/Social/targets'
import type { ThreadChain } from '../../Support/Social/threads'
import type { CrosspostTargetResult, PublishContent, SocialProvider } from '../../Support/Social/types'
import { db, sqliteWriteOptions } from '@stacksjs/database'
import { log } from '@stacksjs/logging'
import { parseTarget, resolveTargets, targetKey } from '../../Support/Social/targets'
import { normalizeIdentityHandle } from '../../Support/Social/accounts'
import { advanceChain, threadPostOptions, threadSegmentContent } from '../../Support/Social/threads'
import { resolveVariantBody } from '../../Support/Social/variants'
import { blog } from './BlogService'
import { bluesky } from './BlueskyService'
import { instagram } from './InstagramService'
import { linkedin } from './LinkedInService'
import { mastodon } from './MastodonService'
import { threads } from './ThreadsService'
import { twitter } from './TwitterService'
import { workspace } from '../WorkspaceService'
import { postWebhooks } from '../PostWebhookService'
import { UserFacingError } from '../../Support/Http/user-error'
import { fitImage, suits } from '../../Support/Social/image-fit'
import { persistTempMedia, removeTempMedia } from '../../Support/Social/uploads'
import type { MediaShare } from '../../Support/Social/media-share'
import { openMediaShare } from '../../Support/Social/media-share'
import { MEDIA_RULES } from '../../Support/Social/media-rules'
import { InvalidStoredPostOptionsError, requireStoredPostOptions } from '../../Support/Social/post-options'
import { hydrateStoredContent, MissingMediaError, parseStoredContent } from '../../Support/Social/stored-content'
import { removeMediaFiles, storeAttachments } from '../../Support/Social/stored-attachments'
import { assertVideoAllowed, checkVideoBytes } from '../../Support/Social/video-input'
import { ensureAccount, now, uuid } from './support'
import { postFirstComments } from './PostFirstCommentService'
import { browserThreadAccounts, bindRestoredTargets } from './identities'
import { AlreadyPublishingError, claimThread, refreshThreadClaim, runClaimedThread, ThreadRemovalPendingError } from './thread-publish'

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

function validateVideo(targets: readonly PublishTarget[], content?: PublishContent): void {
  if (!content?.video) return
  assertVideoAllowed(targets.map(target => target.provider), Boolean(content.media?.length), content.options)
  const checked = checkVideoBytes(content.video.bytes, content.video.altText)
  if (!checked.ok) throw new UserFacingError(checked.error)
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

    validateVideo(selected, content)
    const accountId = await ensureAccount()
    const postUuid = uuid()
    const createdAt = now()
    const timezone = await workspace.timezone()
    const stored: StoredContent = { options: content?.options }
    if (content?.video) stored.media = await storeAttachments(postUuid, [content.video])

    try {
      await database.insertInto('posts').values({
        uuid: postUuid,
        title: body.slice(0, 80),
        body,
        status: 'publishing',
        timezone,
        source: 'composer',
        ...(stored.options || stored.media ? { content: JSON.stringify(stored) } : {}),
        account_id: accountId,
        created_at: createdAt,
        updated_at: createdAt,
      }).execute()
    }
    catch (error) {
      await removeMediaFiles(stored.media)
      throw error
    }

    const post = await database
      .selectFrom('posts')
      .selectAll()
      .where('uuid', '=', postUuid)
      .executeTakeFirstOrThrow()

    const results = await this.publishExisting({ id: Number(post.id), body }, selected, content)

    await this.finishAttempt(Number(post.id), results)

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
    validateVideo(selected, content)
    if (segments.length > 1 && browserThreadAccounts(selected).size) {
      // The browser's single Post all action needs every segment and target
      // in Queue before X can receive permission to submit.
      const { QueueService } = await import('./QueueService')
      const postQueue = new QueueService(this)
      const { postIds } = await postQueue.saveThread({
        texts: segments, providers: selected.map(targetKey), title: content?.title, external: content?.external,
        images: content?.media, video: content?.video, options: content?.options,
      })
      const { results } = await postQueue.publishNow(postIds[0]!)
      return { postIds, results }
    }
    const accountId = await ensureAccount()
    const threadKey = uuid()
    const claim: ReturnType<typeof claimThread> = await database.transaction((tx: typeof database) => claimThread(tx, threadKey), sqliteWriteOptions())
    return await runClaimedThread(claim, async () => {
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
        const timezone = await workspace.timezone()
        // On resume, the lead keeps its video and each segment keeps its options.
        const stored: StoredContent = { options: threadPostOptions(index, content?.options) }
        if (index === 0 && content?.video) stored.media = await storeAttachments(postUuid, [content.video])

        try {
          await database.insertInto('posts').values({
            uuid: postUuid,
            title: body.slice(0, 80),
            body,
            status: 'publishing',
            timezone,
            source: 'composer',
            thread_key: threadKey,
            ...(stored.options || stored.media ? { content: JSON.stringify(stored) } : {}),
            account_id: accountId,
            created_at: createdAt,
            updated_at: createdAt,
          }).execute()
        }
        catch (error) {
          await removeMediaFiles(stored.media)
          throw error
        }

        const post = await database
          .selectFrom('posts')
          .selectAll()
          .where('uuid', '=', postUuid)
          .executeTakeFirstOrThrow()
        postIds.push(Number(post.id))

        const segmentResults: CrosspostTargetResult[] = []
        for (const target of selected) {
          await refreshThreadClaim(claim)
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
        await this.finishAttempt(Number(post.id), segmentResults)
      }

      return { postIds, results }
    })
  }

  /**
   * Carry on a thread from where it stopped (#100).
   *
   * For each account the thread went to, the first segment that did not go
   * out is sent again as a reply to the last one that did, and the rest
   * follow, with the same rule as the first run: a failure stops that
   * account there. Accounts that already have every segment are left alone.
   */
  async resumeThread(threadKey: string, expected?: { postId: number, scheduledAt: string }): Promise<{ resumed: number, results: CrosspostTargetResult[] }> {
    const prepare = (tx: typeof database) => {
      const claim = claimThread(tx, threadKey)
      if (tx.selectFrom('posts').select('id').where('thread_key', '=', threadKey).where('status', '=', 'archived')
        .where('queue_undo_until', '>', now()).executeTakeFirst())
        throw new ThreadRemovalPendingError()
      const posts: Array<{ id: number, status: string, body: string, content: string | null, scheduled_at: string | null }> = tx
        .selectFrom('posts').selectAll().where('thread_key', '=', threadKey).where('status', '!=', 'archived').orderBy('id', 'asc').execute()
      if (!posts.length) throw new UserFacingError('That thread is not in the queue any more.')
      if (posts.some(post => post.status === 'publishing')) throw new AlreadyPublishingError()
      if (expected && !posts.some(post => Number(post.id) === expected.postId && post.status === 'scheduled' && post.scheduled_at === expected.scheduledAt))
        throw new AlreadyPublishingError()
      const rows = bindRestoredTargets(tx, tx.selectFrom('post_targets').selectAll().where('post_id', 'in', posts.map(post => post.id)).execute()) as Array<{
        id: number, post_id: number, provider: SocialProvider, social_identity_id: number | null, status: string, remote_uri: string | null, remote_cid: string | null
      }>
      const browser = browserThreadAccounts(rows.map(row => ({ provider: row.provider, identityId: row.social_identity_id })), tx)
      tx.updateTable('posts').set({ status: 'publishing', updated_at: now() })
        .where('thread_key', '=', threadKey).where('status', 'in', ['scheduled', 'draft']).execute()
      return { claim, posts, rows, browser }
    }
    const { claim, posts, rows, browser }: ReturnType<typeof prepare> = await database.transaction(prepare, sqliteWriteOptions())

    return await runClaimedThread(claim, async () => {
      const keyOf = (row: typeof rows[number]) => targetKey({ provider: row.provider, identityId: Number(row.social_identity_id) || null })
      const targets = new Map<string, PublishTarget>()
      for (const row of rows) targets.set(keyOf(row), { provider: row.provider, identityId: Number(row.social_identity_id) || null })
      const savedOptions = parseStoredContent(posts[0]?.content)?.options
      let lead: Promise<PublishContent | undefined> | undefined
      const results: CrosspostTargetResult[] = []
      let resumed = 0
      for (const [key, target] of targets) {
        const forTarget = (postId: number) => rows.filter(row => Number(row.post_id) === postId && keyOf(row) === key)
        const start = posts.findIndex(post => !forTarget(Number(post.id)).some(row => row.status === 'published'))
        if (start === -1) continue
        resumed++
        const browserHandle = target.identityId && target.provider === 'twitter' ? browser.get(target.identityId) : undefined
        if (browserHandle && target.identityId && posts.length > 1) {
          await refreshThreadClaim(claim)
          const placeholders: Array<{ postId: number, index: number, ids: number[] }> = await database.transaction((tx: typeof database) => {
            return posts.flatMap((post, index) => {
              if (index < start || forTarget(post.id).some(row => row.status === 'published')) return []
              const ids = forTarget(post.id).map(row => Number(row.id))
              const at = now()
              if (ids.length) tx.updateTable('post_targets').set({ status: 'publishing', updated_at: at }).where('id', 'in', ids).execute()
              else {
                const row = tx.insertInto('post_targets').values({
                  uuid: uuid(), post_id: post.id, provider: 'twitter', social_identity_id: target.identityId,
                  status: 'publishing', created_at: at, updated_at: at,
                }).returning('id').executeTakeFirstOrThrow()
                ids.push(Number(row.id))
              }
              return [{ postId: post.id, index, ids }]
            })
          }, sqliteWriteOptions())
          const allowNewBatch = !posts.some(post => forTarget(post.id).some(row => row.status === 'published'))
          const sent = await twitter.publishBrowserThread(posts, target.identityId, browserHandle,
            () => lead ??= hydrateStoredContent(posts[0]?.content), allowNewBatch)
          await refreshThreadClaim(claim)
          for (const placeholder of placeholders) {
            const result = sent[placeholder.index]!
            const old = rows.filter(row => row.post_id === placeholder.postId && row.provider === 'twitter').map(row => Number(row.id))
            await this.finishThreadTarget(placeholder.postId, target, result, placeholder.ids, old)
            await this.finishAttempt(placeholder.postId, [result], true)
            results.push(result)
          }
          continue
        }

        // The first sent segment is the root and the last sent one is the parent.
        let chain: ThreadChain | undefined
        for (const post of posts.slice(0, start)) {
          const sent = forTarget(Number(post.id)).find(row => row.status === 'published')
          if (sent?.remote_uri && sent?.remote_cid)
            chain = advanceChain(chain, { ok: true, uri: sent.remote_uri, cid: sent.remote_cid })
        }

        let halted: number | undefined
        for (const [index, post] of posts.entries()) {
          const previous = forTarget(Number(post.id))
          if (index < start || previous.some(row => row.status === 'published')) continue
          await refreshThreadClaim(claim)
          // Keep a record of the current destination until its outcome is durable.
          const placeholders = previous.map(row => Number(row.id))
          if (placeholders.length) {
            await database.updateTable('post_targets').set({ status: 'publishing', updated_at: now() })
              .where('id', 'in', placeholders).execute()
          }
          else {
            const pending = await database.insertInto('post_targets').values({
              uuid: uuid(), post_id: post.id, provider: target.provider, social_identity_id: target.identityId,
              status: 'publishing', created_at: now(), updated_at: now(),
            }).returning('id').executeTakeFirstOrThrow()
            placeholders.push(Number(pending.id))
          }

          let result: CrosspostTargetResult
          if (halted !== undefined) {
            result = await this.recordHeldBack(target, Number(post.id), halted, posts.length)
          }
          else {
            try {
              const content = index === 0
                ? await (lead ??= hydrateStoredContent(post.content))
                : { options: requireStoredPostOptions(savedOptions) }
              result = await this.publishTarget(target, { id: Number(post.id), body: post.body }, threadSegmentContent(index, content, chain))
            }
            catch (error) {
              if (!(error instanceof MissingMediaError || error instanceof InvalidStoredPostOptionsError)) throw error
              result = await this.recordTargetFailure(target, Number(post.id), error.message)
            }
            if (!result.ok) halted = index
            const advanced = advanceChain(chain, result)
            if (advanced) chain = advanced
            await this.finishAttempt(Number(post.id), [result], true)
          }
          const existingIds = rows.filter(row => row.post_id === post.id && row.provider === target.provider).map(row => Number(row.id))
          await this.finishThreadTarget(Number(post.id), target, result, placeholders, existingIds)
          results.push(result)
        }
      }

      return { resumed, results }
    })
  }

  private async finishThreadTarget(postId: number, target: PublishTarget, result: CrosspostTargetResult, placeholders: number[], oldRows: number[]): Promise<void> {
    const identityId = result.identityId ?? target.identityId
    await database.transaction((tx: typeof database) => {
      const saved = tx.selectFrom('post_targets').select('id').where('post_id', '=', postId).where('provider', '=', target.provider)
        .where('social_identity_id', identityId ? '=' : 'is', identityId)
        .where('id', 'not in', [...new Set([...oldRows, ...placeholders])]).where('status', '=', result.ok ? 'published' : 'failed')
        .executeTakeFirst()
      if (!saved) {
        tx.updateTable('post_targets').set({
          status: result.ok ? 'published' : 'failed', social_identity_id: identityId,
          remote_uri: result.uri || null, remote_cid: result.cid || null, remote_url: result.url || null,
          failure_reason: result.ok ? null : result.error || 'Publishing failed.', next_attempt_at: null, updated_at: now(),
        }).where('id', '=', placeholders[0]).execute()
      }
      const superseded = saved ? placeholders : placeholders.slice(1)
      if (superseded.length) tx.deleteFrom('post_targets').where('id', 'in', superseded).execute()
    }, sqliteWriteOptions())
  }

  private async finishAttempt(postId: number, results: CrosspostTargetResult[], resume = false): Promise<void> {
    const published = results.some(result => result.ok)
    const at = now()
    await database.transaction((tx: typeof database) => {
      if (published || !resume) {
        const previous = resume && tx.selectFrom('posts').select('published_at').where('id', '=', postId).executeTakeFirst()
        tx.updateTable('posts').set({
          status: published ? 'published' : 'failed',
          ...(published && !previous?.published_at ? { published_at: at } : {}),
          updated_at: at,
        }).where('id', '=', postId).execute()
      }
      postWebhooks.enqueueAttempt(tx, postId, results)
    })
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
    return this.recordTargetFailure(target, postId, `Not sent: post ${failedIndex + 1} of ${total} in this thread failed here, so the rest were held back.`)
  }

  private async recordTargetFailure(target: PublishTarget, postId: number, error: string): Promise<CrosspostTargetResult> {
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
    if (content?.replyTarget) {
      const explicit = targets.length === 1 ? parseTarget(targets[0]) : null
      if (!explicit?.identityId || targetKey(explicit) !== content.replyTarget)
        throw new UserFacingError('This reply must use the account that received the original conversation.')
    }
    const selected = await this.resolve(targets)
    validateVideo(selected, content)
    const twitterIds = selected.flatMap(target => target.provider === 'twitter' && target.identityId ? [target.identityId] : [])
    const conflicting = new Set<number>()
    if (twitterIds.length > 1) {
      const accounts: Array<{ id: number, handle: string, auth_transport: string }> = await database
        .selectFrom('social_identities').select(['id', 'handle', 'auth_transport']).where('id', 'in', twitterIds).execute()
      for (const browser of accounts.filter(account => account.auth_transport === 'browser')) {
        const repeated = accounts.filter(account => account.auth_transport === 'api'
          && normalizeIdentityHandle(account.handle) === normalizeIdentityHandle(browser.handle))
        if (repeated.length) {
          conflicting.add(Number(browser.id))
          for (const account of repeated) conflicting.add(Number(account.id))
        }
      }
    }
    for (const target of selected) {
      if (target.provider === 'twitter' && target.identityId && conflicting.has(target.identityId)) {
        results.push(await this.recordTargetFailure(target, post.id, 'Choose one connection for this X account. Both its API and browser connections are selected.'))
        continue
      }
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
      if (content?.video) assertVideoAllowed([target.provider], Boolean(content.media?.length), content.options)
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
    const provider = result.provider
    if (result.ok && result.targetId && (provider === 'linkedin' || provider === 'instagram') && content?.options?.firstComments?.[provider]) {
      try {
        result.firstComment = await postFirstComments.send(result.targetId) ?? { status: 'pending' }
      }
      catch {
        // The parent is already published. The outbox handles the comment
        // separately even if a failure prevented recording its result here.
        log.warn(`[postline] could not record first comment for target ${result.targetId}`)
        result.firstComment = { status: 'pending' }
      }
    }
    return {
      ...result,
      ...(identityId ? { identityId } : {}),
      target: targetKey({ provider: result.provider, identityId: identityId ?? null }),
    }
  }
}

export const crosspost = new CrosspostService()
