import type { AuthoredPost, ProviderPurgeAdapter, SocialProvider } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { bluesky } from './BlueskyService'
import { linkedin } from './LinkedInService'
import { mastodon } from './MastodonService'
import { postline } from './PostlineService'
import { ensureAccount, now, uuid } from './support'
import { twitter } from './TwitterService'

const database = db as any

/**
 * Bulk deletion of an account's posts. This is the most destructive thing
 * Postline can do — remote posts cannot be restored once deleted — so every
 * run is gated on an exact confirmation phrase, is previewable first, is
 * capped, and is written to `purge_runs` whether it previews or executes.
 */

/** Exact phrase a caller must send to execute (not preview) a purge. */
export const PURGE_CONFIRMATION = 'DELETE ALL POSTS'

/** Providers whose API can delete a post the account authored. */
export const PURGEABLE_PROVIDERS: SocialProvider[] = ['postline', 'bluesky', 'twitter', 'mastodon', 'linkedin']

/**
 * Why the remaining providers can't take part, shown verbatim in the UI.
 *
 * LinkedIn is absent by design: it deletes fine, and `all` scope is attempted
 * rather than pre-blocked — enumerating history needs `r_member_social`, which
 * an approved partner app may well hold. When it doesn't, the driver's 403 is
 * translated into an actionable skip reason at run time.
 */
const UNSUPPORTED_REASONS: Partial<Record<SocialProvider, string>> = {
  instagram: 'The Instagram Graph API cannot delete feed posts — remove them in the Instagram app.',
  threads: 'The Threads API cannot delete posts — remove them in the Threads app.',
  facebook: 'Facebook is not a connected publishing target.',
  tiktok: 'TikTok is not a connected publishing target.',
  blog: 'Blog posts are managed from the blog, not the purge tool.',
}

/** Hard ceiling on one run, so a runaway loop can't delete unboundedly. */
const MAX_DELETIONS_PER_RUN = 2000

/** Pause between deletes — providers rate-limit destructive endpoints hard. */
const DELETE_DELAY_MS = 250

/** Most per-post errors kept in the audit row; the count is always exact. */
const MAX_RECORDED_ERRORS = 25

export type PurgeScope = 'tracked' | 'all'

export interface PurgeInput {
  providers?: SocialProvider[]
  scope?: PurgeScope
  confirmation?: string
  dryRun?: boolean
}

export interface PurgeProviderResult {
  provider: SocialProvider
  handle: string | null
  supported: boolean
  connected: boolean
  matched: number
  deleted: number
  failed: number
  localRemoved: number
  /** True when the run hit MAX_DELETIONS_PER_RUN and more posts remain. */
  truncated: boolean
  sample: Array<{ uri: string, text?: string, postedAt?: string }>
  errors: string[]
  skippedReason?: string
}

export interface PurgeResult {
  scope: PurgeScope
  dryRun: boolean
  confirmation: string
  matched: number
  deleted: number
  failed: number
  providers: PurgeProviderResult[]
}

/** One post queued for deletion, with the local rows it maps back to. */
interface PurgeCandidate {
  uri: string
  cid?: string
  text?: string
  postedAt?: string
  targetId?: number
  postId?: number
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** SQLite has a bound-parameter ceiling, so `in (...)` lookups go in chunks. */
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

export class PurgeService {
  /**
   * Dry run: what a purge *would* delete, per provider, without touching
   * anything remote. Safe to call freely — it still writes a `preview` audit
   * row so the intent is on record.
   */
  async preview(input: PurgeInput = {}): Promise<PurgeResult> {
    return await this.run({ ...input, dryRun: true })
  }

  /**
   * Execute a purge. Requires the exact confirmation phrase; anything else
   * throws before a single delete is issued.
   */
  async purge(input: PurgeInput): Promise<PurgeResult> {
    if (String(input.confirmation || '').trim() !== PURGE_CONFIRMATION) {
      throw new Error(`Type "${PURGE_CONFIRMATION}" to confirm. Nothing was deleted.`)
    }
    return await this.run({ ...input, dryRun: false })
  }

  private async run(input: PurgeInput & { dryRun: boolean }): Promise<PurgeResult> {
    const scope: PurgeScope = input.scope === 'all' ? 'all' : 'tracked'
    const providers = this.resolveProviders(input.providers)
    const results: PurgeProviderResult[] = []

    for (const provider of providers) {
      results.push(await this.runProvider(provider, scope, input.dryRun))
    }

    return {
      scope,
      dryRun: input.dryRun,
      confirmation: PURGE_CONFIRMATION,
      matched: results.reduce((total, result) => total + result.matched, 0),
      deleted: results.reduce((total, result) => total + result.deleted, 0),
      failed: results.reduce((total, result) => total + result.failed, 0),
      providers: results,
    }
  }

  /** Default to every purgeable provider; reject anything unrecognized. */
  private resolveProviders(requested?: SocialProvider[]): SocialProvider[] {
    if (!requested?.length) return [...PURGEABLE_PROVIDERS]

    const unknown = requested.filter(provider => !(provider in UNSUPPORTED_REASONS) && !PURGEABLE_PROVIDERS.includes(provider))
    if (unknown.length) throw new Error(`Unknown provider: ${unknown.join(', ')}.`)

    // De-duplicate while preserving the caller's order.
    return [...new Set(requested)]
  }

  private async runProvider(provider: SocialProvider, scope: PurgeScope, dryRun: boolean): Promise<PurgeProviderResult> {
    const result: PurgeProviderResult = {
      provider,
      handle: null,
      supported: PURGEABLE_PROVIDERS.includes(provider),
      connected: false,
      matched: 0,
      deleted: 0,
      failed: 0,
      localRemoved: 0,
      truncated: false,
      sample: [],
      errors: [],
    }

    if (!result.supported) {
      result.skippedReason = UNSUPPORTED_REASONS[provider] || `${provider} cannot delete posts through its API.`
      await this.recordRun(result, scope, dryRun, 'skipped')
      return result
    }

    let adapter: ProviderPurgeAdapter
    try {
      adapter = await this.adapterFor(provider)
    }
    catch (error) {
      result.skippedReason = messageOf(error)
      await this.recordRun(result, scope, dryRun, 'skipped')
      return result
    }

    result.connected = true
    result.handle = adapter.handle

    let candidates: PurgeCandidate[]
    try {
      candidates = scope === 'all'
        ? await this.collectRemote(adapter, result)
        : await this.collectTracked(provider, adapter.identityId)
    }
    catch (error) {
      // A provider that can delete but not enumerate lands here in `all` scope.
      // Surface it as a skip with the reason, so the UI explains the way
      // forward instead of reporting a bare zero.
      const message = messageOf(error)
      result.skippedReason = message
      result.errors.push(message)
      await this.recordRun(result, scope, dryRun, 'skipped', message)
      return result
    }

    if (candidates.length > MAX_DELETIONS_PER_RUN) {
      result.truncated = true
      candidates = candidates.slice(0, MAX_DELETIONS_PER_RUN)
    }

    result.matched = candidates.length
    result.sample = candidates.slice(0, 5).map(candidate => ({
      uri: candidate.uri,
      text: candidate.text,
      postedAt: candidate.postedAt,
    }))

    if (dryRun) {
      await this.recordRun(result, scope, dryRun, 'previewed')
      return result
    }

    const deletedTargetIds: number[] = []
    const affectedPostIds = new Set<number>()

    for (const [index, candidate] of candidates.entries()) {
      try {
        await adapter.deletePost({ uri: candidate.uri, cid: candidate.cid })
        result.deleted += 1
        if (candidate.targetId) deletedTargetIds.push(candidate.targetId)
        if (candidate.postId) affectedPostIds.add(candidate.postId)
      }
      catch (error) {
        result.failed += 1
        if (result.errors.length < MAX_RECORDED_ERRORS) {
          result.errors.push(`${candidate.uri}: ${messageOf(error)}`)
        }
      }

      if (index < candidates.length - 1) await sleep(DELETE_DELAY_MS)
    }

    // In `all` scope the local targets are gone remotely by definition, so
    // sweep every one of this provider's targets — not just the ones this run
    // happened to match — but only when nothing failed.
    if (scope === 'all' && result.failed === 0) {
      const remaining = await this.collectTracked(provider, adapter.identityId)
      for (const target of remaining) {
        if (target.targetId) deletedTargetIds.push(target.targetId)
        if (target.postId) affectedPostIds.add(target.postId)
      }
    }

    result.localRemoved = await this.removeLocal(deletedTargetIds, affectedPostIds, adapter.identityId, candidates)

    const status = result.failed === 0 ? 'completed' : result.deleted > 0 ? 'partial' : 'failed'
    await this.recordRun(result, scope, dryRun, status)
    return result
  }

  private async adapterFor(provider: SocialProvider): Promise<ProviderPurgeAdapter> {
    if (provider === 'bluesky') return await bluesky.purgeAdapter()
    if (provider === 'twitter') return await twitter.purgeAdapter()
    if (provider === 'mastodon') return await mastodon.purgeAdapter()
    if (provider === 'linkedin') return await linkedin.purgeAdapter()
    if (provider === 'postline') return await postline.purgeAdapter()
    throw new Error(`${provider} cannot delete posts through its API.`)
  }

  /** Posts Postline itself published to this provider. */
  private async collectTracked(provider: SocialProvider, identityId: number): Promise<PurgeCandidate[]> {
    const targets = await database
      .selectFrom('post_targets')
      .select(['id', 'post_id', 'remote_uri', 'remote_cid'])
      .where('provider', '=', provider)
      .where('social_identity_id', '=', identityId)
      .where('status', '=', 'published')
      .orderBy('id', 'desc')
      .execute()

    return (targets as any[])
      .filter(target => target.remote_uri || target.remote_cid)
      .map(target => ({
        uri: String(target.remote_uri || target.remote_cid),
        cid: target.remote_cid ? String(target.remote_cid) : undefined,
        targetId: Number(target.id),
        postId: target.post_id ? Number(target.post_id) : undefined,
      }))
  }

  /**
   * Everything the account ever posted, walked page by page. Also maps each
   * remote post back to a Postline target row where one exists, so local
   * cleanup stays accurate.
   */
  private async collectRemote(adapter: ProviderPurgeAdapter, result: PurgeProviderResult): Promise<PurgeCandidate[]> {
    const tracked = await this.collectTracked(adapter.provider, adapter.identityId)
    const byUri = new Map<string, PurgeCandidate>()
    for (const candidate of tracked) {
      byUri.set(candidate.uri, candidate)
      if (candidate.cid) byUri.set(candidate.cid, candidate)
    }

    const collected: PurgeCandidate[] = []
    const seen = new Set<string>()
    let cursor: string | undefined

    // Bounded by the cap plus one page, so a provider that keeps handing back
    // a cursor can never spin forever.
    while (collected.length <= MAX_DELETIONS_PER_RUN) {
      const page: { cursor?: string, posts: AuthoredPost[] } = await adapter.listPage(cursor)
      const fresh = page.posts.filter(post => post.uri && !seen.has(post.uri))
      if (!fresh.length) break

      for (const post of fresh) {
        seen.add(post.uri)
        const local = byUri.get(post.uri) || (post.cid ? byUri.get(post.cid) : undefined)
        collected.push({
          uri: post.uri,
          cid: post.cid,
          text: post.text,
          postedAt: post.postedAt,
          targetId: local?.targetId,
          postId: local?.postId,
        })
      }

      cursor = page.cursor
      if (!cursor) break
    }

    if (collected.length > MAX_DELETIONS_PER_RUN) result.truncated = true
    return collected
  }

  /**
   * Drop the local rows behind successfully deleted posts: the targets, any
   * post left with no targets at all (plus its media rows), and cached
   * timeline entries pointing at posts that no longer exist.
   */
  private async removeLocal(
    targetIds: number[],
    affectedPostIds: Set<number>,
    identityId: number,
    candidates: PurgeCandidate[],
  ): Promise<number> {
    let removed = 0

    for (const ids of chunk([...new Set(targetIds)], 200)) {
      if (!ids.length) continue
      await database.deleteFrom('post_targets').where('id', 'in', ids).execute()
      removed += ids.length
    }

    // Only posts that *had* targets are eligible — a draft has none and must
    // survive a purge untouched.
    for (const postIds of chunk([...affectedPostIds], 200)) {
      if (!postIds.length) continue
      const survivors = await database
        .selectFrom('post_targets')
        .select(['post_id'])
        .where('post_id', 'in', postIds)
        .execute()

      const stillTargeted = new Set((survivors as any[]).map(row => Number(row.post_id)))
      const orphaned = postIds.filter(id => !stillTargeted.has(id))
      if (!orphaned.length) continue

      await database.deleteFrom('media_assets').where('post_id', 'in', orphaned).execute()
      await database.deleteFrom('posts').where('id', 'in', orphaned).execute()
      removed += orphaned.length
    }

    const uris = candidates.map(candidate => candidate.uri).filter(Boolean)
    for (const batch of chunk(uris, 200)) {
      if (!batch.length) continue
      await database
        .deleteFrom('timeline_items')
        .where('social_identity_id', '=', identityId)
        .where('remote_uri', 'in', batch)
        .execute()
    }

    return removed
  }

  /** Write the audit row. Never throws — a logging failure must not mask a purge. */
  private async recordRun(
    result: PurgeProviderResult,
    scope: PurgeScope,
    dryRun: boolean,
    status: 'previewed' | 'completed' | 'partial' | 'failed' | 'skipped',
    failureReason?: string,
  ): Promise<void> {
    try {
      const accountId = await ensureAccount()
      const timestamp = now()

      await database.insertInto('purge_runs').values({
        uuid: uuid(),
        provider: result.provider,
        handle: result.handle,
        scope,
        mode: dryRun ? 'preview' : 'execute',
        status,
        matched_count: result.matched,
        deleted_count: result.deleted,
        failed_count: result.failed,
        details: JSON.stringify({
          truncated: result.truncated,
          localRemoved: result.localRemoved,
          sample: result.sample,
          errors: result.errors,
        }),
        failure_reason: failureReason || result.skippedReason || null,
        finished_at: timestamp,
        account_id: accountId,
        created_at: timestamp,
        updated_at: timestamp,
      }).execute()
    }
    catch {
      // Audit is best-effort; the caller still gets the full result.
    }
  }
}

export const postPurge = new PurgeService()
