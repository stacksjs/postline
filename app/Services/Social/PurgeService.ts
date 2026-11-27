import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import process from 'node:process'
import type { AuthoredPost, ProviderPurgeAdapter, SocialProvider } from '../../Support/Social/types'
import { db } from '@stacksjs/database'
import { acquirePurgeLock } from '../../Support/Social/purge-lock'
import { bluesky } from './BlueskyService'
import { linkedin } from './LinkedInService'
import { mastodon } from './MastodonService'
import { threads } from './ThreadsService'
import { ensureAccount, now, uuid } from './support'
import { UserFacingError } from '../../Support/Http/user-error'
import { twitter } from './TwitterService'
import { describeNetworkError } from '../../Support/Social/network-errors'

const database = db as any

/**
 * Bulk deletion of an account's posts. This is the most destructive thing
 * Postline can do — remote posts cannot be restored once deleted — so every
 * run is gated on an exact confirmation phrase, is previewable first, is
 * capped, and is written to `purge_runs` whether it previews or executes.
 */

/**
 * The phrase that confirms a manual run: the number of posts the preview
 * showed. It used to be one fixed phrase that the preview itself returned, so
 * a client could send it without anyone having read the count.
 */
export function purgeConfirmationFor(matched: number): string {
  return `DELETE ${matched} POSTS`
}

/** Kept for callers that show an example; a run needs `purgeConfirmationFor`. */
export const PURGE_CONFIRMATION = 'DELETE <count> POSTS'

/** Where a background run has got to, for the page that started it. */
export interface PurgeProgress {
  runId: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  /** How many the preview showed: the most this run will delete. */
  limit: number
  deleted: number
  failed: number
  startedAt: string
  finishedAt: string | null
  /** The full result once the run has finished. */
  result: PurgeResult | null
  error: string | null
}

/** How long a preview may be acted on: long enough to read it, too short to forget it. */
export const PREVIEW_TTL_MS = 15 * 60 * 1000

interface PreviewClaims {
  scope: PurgeScope
  providers: string[]
  olderThanDays: number | null
  matched: number
  issuedAt: number
}

function previewKey(): string {
  return String(process.env.APP_KEY || '') || fallbackPreviewKey
}
const fallbackPreviewKey = crypto.randomUUID()

function signClaims(claims: PreviewClaims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = new Bun.CryptoHasher('sha256', previewKey()).update(body).digest('base64url')
  return `${body}.${signature}`
}

/**
 * Read a preview token back, or say why it cannot be used. It must be signed
 * by this install, recent, and for exactly the selection being run.
 */
export function readPreviewToken(token: unknown, expected: { scope: PurgeScope, providers: string[], olderThanDays: number | null }, nowMs: number = Date.now()): PreviewClaims {
  const [body, signature] = String(token || '').split('.')
  if (!body || !signature)
    throw new UserFacingError('Run a preview first. Nothing was deleted.')
  const valid = new Bun.CryptoHasher('sha256', previewKey()).update(body).digest('base64url')
  if (valid.length !== signature.length || !timingSafeEqual(Buffer.from(valid), Buffer.from(signature)))
    throw new UserFacingError('That preview is not one this Postline made. Run the preview again. Nothing was deleted.')

  let claims: PreviewClaims
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  }
  catch {
    throw new UserFacingError('Run the preview again. Nothing was deleted.')
  }
  if (nowMs - claims.issuedAt > PREVIEW_TTL_MS)
    throw new UserFacingError('That preview is more than 15 minutes old. Run it again. Nothing was deleted.')
  const same = claims.scope === expected.scope
    && claims.olderThanDays === expected.olderThanDays
    && [...claims.providers].sort().join(',') === [...expected.providers].sort().join(',')
  if (!same)
    throw new UserFacingError('The selection changed since the preview. Run the preview again. Nothing was deleted.')
  return claims
}

/** Providers whose API can delete a post the account authored. */
export const PURGEABLE_PROVIDERS: SocialProvider[] = ['bluesky', 'twitter', 'mastodon', 'linkedin', 'threads']

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
  facebook: 'Facebook is not a connected publishing target.',
  tiktok: 'TikTok is not a connected publishing target.',
  blog: 'Blog posts are managed from the blog, not the purge tool.',
}

/**
 * Networks that cap deletions per day. Threads allows 100 in 24 hours per
 * profile (#133); past that it refuses, so a run trims itself to what is
 * left and the preview says so.
 */
export const DAILY_DELETE_LIMITS: Partial<Record<SocialProvider, number>> = {
  threads: 100,
}

/** Hard ceiling on one run, so a runaway loop can't delete unboundedly. */
const MAX_DELETIONS_PER_RUN = 2000

/** Pause between deletes — providers rate-limit destructive endpoints hard. */
const DELETE_DELAY_MS = 250

/**
 * Networks whose delete limit is tighter than the pause above (#136). X allows
 * 50 deletes per 15 minutes for each user, one every 18 seconds; going faster
 * only earns refusals partway through a run.
 */
export const DELETE_PACING_MS: Partial<Record<SocialProvider, number>> = {
  twitter: 18_000,
}

/** The pause between two deletes on `provider`: its own pacing, never less than the default. */
export function deletePause(provider: SocialProvider, base: number = DELETE_DELAY_MS): number {
  return Math.max(base, DELETE_PACING_MS[provider] ?? 0)
}

/** Most per-post errors kept in the audit row; the count is always exact. */
const MAX_RECORDED_ERRORS = 25

/**
 * Most remote posts an age-limited run will page through looking for old
 * ones. Feeds list newest first, so reaching the posts past the cutoff can
 * mean walking past many recent ones that are kept.
 */
const MAX_SCANNED_PER_RUN = 20000

export type PurgeScope = 'tracked' | 'all'

export interface PurgeInput {
  providers?: SocialProvider[]
  scope?: PurgeScope
  confirmation?: string
  /** The token the preview returned; a manual run needs it. */
  previewToken?: string
  dryRun?: boolean
  /**
   * Only posts published more than this many days ago. A post whose age
   * cannot be established is kept, never assumed old.
   */
  olderThanDays?: number
}

/** What started a run, recorded on its audit rows. */
export type PurgeTrigger = 'manual' | 'schedule'

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
  /** For a network with a daily cap: the cap, and how many deletions are left in the last 24 hours. */
  dailyLimit?: { limit: number, remaining: number }
}

export interface PurgeResult {
  scope: PurgeScope
  dryRun: boolean
  olderThanDays: number | null
  /** ISO time posts must predate to match, when olderThanDays is set. */
  cutoff: string | null
  confirmation: string
  /** On a preview: what a run of exactly this selection must send back. */
  previewToken?: string
  matched: number
  deleted: number
  failed: number
  providers: PurgeProviderResult[]
}

/** One connected account a pass runs against. */
interface PurgeAccount {
  id: number
  isDefault: boolean
}

/** Services that can list several accounts per network. */
const ACCOUNT_SERVICES: Partial<Record<SocialProvider, { listAccounts: () => Promise<Array<{ id: number, connected: boolean, isDefault: boolean }>> }>> = {
  bluesky,
  twitter,
  mastodon,
  linkedin,
}

/** Everything about a run that each provider pass needs. */
interface RunContext {
  scope: PurgeScope
  dryRun: boolean
  cutoff: Date | null
  olderThanDays: number | null
  trigger: PurgeTrigger
  /** Deletions left in this run: a manual run stops at the count its preview showed. */
  budget: { left: number }
  /** A background run's progress, updated after each deletion. */
  progress?: PurgeProgress
  /** True once the owner asked a background run to stop. */
  cancelled?: () => boolean
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

/**
 * Parse the timestamps this code meets: ISO strings from provider APIs, and
 * SQLite's `YYYY-MM-DD HH:MM:SS`, which `now()` writes in UTC without saying so.
 */
export function parseTimestamp(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)
  const date = new Date(sqlite ? `${text.replace(' ', 'T')}Z` : text)
  return Number.isNaN(date.getTime()) ? null : date
}

/** The instant a post must predate to be `olderThanDays` old. */
export function cutoffFor(olderThanDays: number | undefined, from = new Date()): Date | null {
  if (olderThanDays === undefined || olderThanDays === null) return null
  const days = Number(olderThanDays)
  if (!Number.isFinite(days) || days < 1) throw new Error('Age limit must be at least one day.')
  return new Date(from.getTime() - Math.floor(days) * 24 * 60 * 60 * 1000)
}

/** True only for a candidate dated before the cutoff; undated ones are kept. */
export function isOlderThan(postedAt: string | undefined, cutoff: Date): boolean {
  const date = parseTimestamp(postedAt)
  return date !== null && date.getTime() < cutoff.getTime()
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
  /** The pause between deletes. Tests set it to 0. */
  deleteDelayMs = DELETE_DELAY_MS

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
    const limit = this.confirmedLimit(input)
    return await this.run({ ...input, dryRun: false, limit })
  }

  /**
   * Start a confirmed run in the background and return at once. Deleting up
   * to 2,000 posts a quarter second apart takes minutes, and it used to hold
   * the request open for all of them. The page polls `progress(runId)`, and
   * `cancel(runId)` stops it after the deletion in hand.
   */
  start(input: PurgeInput): PurgeProgress {
    const limit = this.confirmedLimit(input)
    // Taken here, before answering, so a second run is refused straight away
    // rather than discovered by polling.
    const release = acquirePurgeLock()
    if (!release)
      throw new UserFacingError('A deletion run is already in progress. Wait for it to finish, then try again.')

    const progress: PurgeProgress = {
      runId: crypto.randomUUID(),
      status: 'running',
      limit,
      deleted: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
      error: null,
    }
    this.runs.set(progress.runId, progress)
    // Keep the last few finished runs for the page to read; drop the rest.
    for (const [id, run] of [...this.runs].slice(0, Math.max(0, this.runs.size - 10))) {
      if (run.status !== 'running') this.runs.delete(id)
    }

    void this.runUnlocked({ ...input, dryRun: false, limit }, progress, () => this.cancelRequested.has(progress.runId))
      .then((result) => {
        progress.result = result
        progress.status = this.cancelRequested.has(progress.runId) ? 'cancelled' : 'completed'
      })
      .catch((error) => {
        progress.status = 'failed'
        progress.error = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        progress.finishedAt = new Date().toISOString()
        this.cancelRequested.delete(progress.runId)
        release()
      })

    return progress
  }

  /** A background run's progress, or null when this process does not know it. */
  progress(runId: string): PurgeProgress | null {
    return this.runs.get(runId) ?? null
  }

  /** Stop a background run after the deletion in hand. Returns false when it is not running. */
  cancel(runId: string): boolean {
    const run = this.runs.get(runId)
    if (!run || run.status !== 'running') return false
    this.cancelRequested.add(runId)
    return true
  }

  private readonly runs = new Map<string, PurgeProgress>()
  private readonly cancelRequested = new Set<string>()

  /**
   * A run acts on a preview the owner has seen: the same selection, at most
   * as many posts as it showed, confirmed by typing that number. Returns that
   * number; throws, deleting nothing, when anything does not match.
   */
  private confirmedLimit(input: PurgeInput): number {
    const claims = readPreviewToken(input.previewToken, {
      scope: input.scope === 'all' ? 'all' : 'tracked',
      providers: this.resolveProviders(input.providers),
      olderThanDays: cutoffFor(input.olderThanDays) ? Math.floor(Number(input.olderThanDays)) : null,
    })
    const phrase = purgeConfirmationFor(claims.matched)
    if (String(input.confirmation || '').trim() !== phrase)
      throw new UserFacingError(`Type "${phrase}" to confirm. Nothing was deleted.`)
    if (claims.matched === 0)
      throw new UserFacingError('The preview matched no posts. Nothing was deleted.')
    return claims.matched
  }

  /**
   * The retention sweep: delete posts older than `olderThanDays`, without the
   * typed phrase. The owner gave that consent once, when they turned automatic
   * deletion on in Settings (RetentionService), and an age limit is mandatory
   * here so a schedule can never become a full wipe.
   */
  async purgeOlderThan(input: PurgeInput & { olderThanDays: number }): Promise<PurgeResult> {
    if (!(Number(input.olderThanDays) >= 1)) throw new Error('Automatic deletion needs an age limit of at least one day.')
    return await this.run({ ...input, dryRun: false, trigger: 'schedule' })
  }

  private async run(input: PurgeInput & { dryRun: boolean, trigger?: PurgeTrigger, limit?: number }): Promise<PurgeResult> {
    // A preview deletes nothing and may overlap anything. A real run may not
    // overlap another: the manual purge runs in the API process and the daily
    // one in the scheduler, and two at once would each page through the same
    // history and race to delete the same posts.
    if (input.dryRun)
      return await this.runUnlocked(input)

    const release = acquirePurgeLock()
    if (!release)
      throw new Error('A deletion run is already in progress. Wait for it to finish, then try again.')
    try {
      return await this.runUnlocked(input)
    }
    finally {
      release()
    }
  }

  private async runUnlocked(input: PurgeInput & { dryRun: boolean, trigger?: PurgeTrigger, limit?: number }, progress?: PurgeProgress, cancelled?: () => boolean): Promise<PurgeResult> {
    const scope: PurgeScope = input.scope === 'all' ? 'all' : 'tracked'
    const providers = this.resolveProviders(input.providers)
    const cutoff = cutoffFor(input.olderThanDays)
    const context: RunContext = {
      scope,
      dryRun: input.dryRun,
      cutoff,
      olderThanDays: cutoff ? Math.floor(Number(input.olderThanDays)) : null,
      trigger: input.trigger || 'manual',
      budget: { left: input.limit ?? Number.POSITIVE_INFINITY },
      progress,
      cancelled,
    }
    const results: PurgeProviderResult[] = []

    // One pass per connected account, so a network with two accounts is
    // purged on both. A network with none still gets one pass, which records
    // why it was skipped.
    for (const provider of providers) {
      if (context.cancelled?.()) break
      const accounts = await this.accountsFor(provider)
      if (!accounts.length) {
        results.push(await this.runProvider(provider, context))
        continue
      }
      for (const account of accounts) {
        results.push(await this.runProvider(provider, context, account))
      }
    }

    const matched = results.reduce((total, result) => total + result.matched, 0)
    return {
      scope,
      dryRun: input.dryRun,
      olderThanDays: context.olderThanDays,
      cutoff: cutoff ? cutoff.toISOString() : null,
      confirmation: purgeConfirmationFor(matched),
      ...(input.dryRun ? { previewToken: signClaims({ scope, providers, olderThanDays: context.olderThanDays, matched, issuedAt: Date.now() }) } : {}),
      matched,
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

  /** Connected accounts on a network, default first; empty when it has none or no accounts at all. */
  private async accountsFor(provider: SocialProvider): Promise<PurgeAccount[]> {
    const service = ACCOUNT_SERVICES[provider]
    if (!service) return []
    try {
      const accounts = (await service.listAccounts()).filter(account => account.connected)
      return accounts
        .sort((left, right) => Number(right.isDefault) - Number(left.isDefault))
        .map(account => ({ id: account.id, isDefault: account.isDefault }))
    }
    catch {
      return []
    }
  }

  private async runProvider(provider: SocialProvider, context: RunContext, account?: PurgeAccount): Promise<PurgeProviderResult> {
    const { scope, dryRun, cutoff } = context
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
      await this.recordRun(result, context, 'skipped')
      return result
    }

    let adapter: ProviderPurgeAdapter
    try {
      adapter = await this.adapterFor(provider, account?.id)
    }
    catch (error) {
      result.skippedReason = describeNetworkError(provider, error, 'delete')
      // A network that was never connected is not news to a daily schedule;
      // writing it down every day would bury the runs that did something.
      if (context.trigger !== 'schedule') await this.recordRun(result, context, 'skipped')
      return result
    }

    result.connected = true
    result.handle = adapter.handle

    let candidates: PurgeCandidate[]
    try {
      candidates = scope === 'all'
        ? await this.collectRemote(adapter, result, cutoff)
        : await this.collectTracked(provider, adapter.identityId, account?.isDefault ?? true)
      if (cutoff) candidates = candidates.filter(candidate => isOlderThan(candidate.postedAt, cutoff))
    }
    catch (error) {
      // A provider that can delete but not enumerate lands here in `all` scope.
      // Surface it as a skip with the reason, so the UI explains the way
      // forward instead of reporting a bare zero.
      const message = describeNetworkError(provider, error, 'delete')
      result.skippedReason = message
      result.errors.push(message)
      await this.recordRun(result, context, 'skipped', message)
      return result
    }

    if (candidates.length > MAX_DELETIONS_PER_RUN) {
      result.truncated = true
      candidates = candidates.slice(0, MAX_DELETIONS_PER_RUN)
    }

    const dailyCap = DAILY_DELETE_LIMITS[provider]
    if (dailyCap) {
      const remaining = Math.max(0, dailyCap - await this.deletedInLastDay(provider, result.handle))
      result.dailyLimit = { limit: dailyCap, remaining }
      if (candidates.length > remaining) {
        result.truncated = true
        candidates = candidates.slice(0, remaining)
      }
    }

    result.matched = candidates.length
    result.sample = candidates.slice(0, 5).map(candidate => ({
      uri: candidate.uri,
      text: candidate.text,
      postedAt: candidate.postedAt,
    }))

    if (dryRun) {
      await this.recordRun(result, context, 'previewed')
      return result
    }

    const deletedTargetIds: number[] = []
    const affectedPostIds = new Set<number>()

    for (const [index, candidate] of candidates.entries()) {
      // Never more than the preview showed: history can grow between the
      // preview and the run, and those posts were not in what was confirmed.
      if (context.budget.left <= 0 || context.cancelled?.()) {
        result.truncated = true
        break
      }
      context.budget.left -= 1
      try {
        await adapter.deletePost({ uri: candidate.uri, cid: candidate.cid })
        result.deleted += 1
        if (context.progress) context.progress.deleted += 1
        if (candidate.targetId) deletedTargetIds.push(candidate.targetId)
        if (candidate.postId) affectedPostIds.add(candidate.postId)
      }
      catch (error) {
        result.failed += 1
        if (context.progress) context.progress.failed += 1
        if (result.errors.length < MAX_RECORDED_ERRORS) {
          result.errors.push(`${candidate.uri}: ${describeNetworkError(provider, error, 'delete')}`)
        }
      }

      if (index < candidates.length - 1) await sleep(this.deleteDelayMs === 0 ? 0 : deletePause(provider, this.deleteDelayMs))
    }

    // In `all` scope the local targets are gone remotely by definition, so
    // sweep every one of this provider's targets — not just the ones this run
    // happened to match — but only when nothing failed. An age-limited run
    // deliberately left the newer posts up, so it keeps their rows too.
    // Not after a list that was cut short either: the posts past the cut
    // are still up, and their rows must stay to say so.
    if (scope === 'all' && !cutoff && result.failed === 0 && !result.truncated) {
      const remaining = await this.collectTracked(provider, adapter.identityId, account?.isDefault ?? true)
      for (const target of remaining) {
        if (target.targetId) deletedTargetIds.push(target.targetId)
        if (target.postId) affectedPostIds.add(target.postId)
      }
    }

    result.localRemoved = await this.removeLocal(deletedTargetIds, affectedPostIds, adapter.identityId, candidates)

    const status = result.failed === 0 ? 'completed' : result.deleted > 0 ? 'partial' : 'failed'
    await this.recordRun(result, context, status)
    return result
  }

  private async adapterFor(provider: SocialProvider, identityId?: number): Promise<ProviderPurgeAdapter> {
    if (provider === 'bluesky') return await bluesky.purgeAdapter(identityId)
    if (provider === 'twitter') return await twitter.purgeAdapter(identityId)
    if (provider === 'mastodon') return await mastodon.purgeAdapter(identityId)
    if (provider === 'linkedin') return await linkedin.purgeAdapter(identityId)
    if (provider === 'threads') return await threads.purgeAdapter(identityId)
    throw new Error(`${provider} cannot delete posts through its API.`)
  }

  /**
   * Posts Postline itself published to this provider, dated by the
   * post's `published_at`, or failing that by when the target row was last
   * written (which is when it was marked published).
   */
  private async collectTracked(provider: SocialProvider, identityId: number, includeUnassigned = false): Promise<PurgeCandidate[]> {
    // A target with no account recorded predates accounts being plural; it
    // was published through the network's default account, so that one owns it.
    const targets = (await database
      .selectFrom('post_targets')
      .select(['id', 'post_id', 'remote_uri', 'remote_cid', 'updated_at', 'social_identity_id'])
      .where('provider', '=', provider)
      .where('status', '=', 'published')
      .where('archived_account', 'is', null)
      .orderBy('id', 'desc')
      .execute() as any[])
      .filter(target => Number(target.social_identity_id) === Number(identityId)
        || (includeUnassigned && (target.social_identity_id === null || target.social_identity_id === undefined)))
      .filter(target => target.remote_uri || target.remote_cid)

    const publishedAt = new Map<number, string>()
    const postIds = [...new Set(targets.map(target => Number(target.post_id)).filter(id => id > 0))]
    for (const ids of chunk(postIds, 200)) {
      const posts = await database.selectFrom('posts').select(['id', 'published_at']).where('id', 'in', ids).execute()
      for (const post of posts as any[]) {
        if (post.published_at) publishedAt.set(Number(post.id), String(post.published_at))
      }
    }

    return targets.map(target => ({
      uri: String(target.remote_uri || target.remote_cid),
      cid: target.remote_cid ? String(target.remote_cid) : undefined,
      postedAt: publishedAt.get(Number(target.post_id)) || (target.updated_at ? String(target.updated_at) : undefined),
      targetId: Number(target.id),
      postId: target.post_id ? Number(target.post_id) : undefined,
    }))
  }

  /**
   * Everything the account ever posted, walked page by page. Also maps each
   * remote post back to a Postline target row where one exists, so local
   * cleanup stays accurate.
   */
  private async collectRemote(adapter: ProviderPurgeAdapter, result: PurgeProviderResult, cutoff: Date | null = null): Promise<PurgeCandidate[]> {
    const tracked = await this.collectTracked(adapter.provider, adapter.identityId, true)
    const byUri = new Map<string, PurgeCandidate>()
    for (const candidate of tracked) {
      byUri.set(candidate.uri, candidate)
      if (candidate.cid) byUri.set(candidate.cid, candidate)
    }

    const collected: PurgeCandidate[] = []
    const seen = new Set<string>()
    let cursor: string | undefined

    // Bounded by the cap plus one page, so a provider that keeps handing back
    // a cursor can never spin forever. With an age limit only old posts count
    // toward the cap, so the scan itself is bounded separately.
    while (collected.length <= MAX_DELETIONS_PER_RUN && seen.size < MAX_SCANNED_PER_RUN) {
      const page: { cursor?: string, posts: AuthoredPost[] } = await adapter.listPage(cursor)
      const fresh = page.posts.filter(post => post.uri && !seen.has(post.uri))
      if (!fresh.length) break

      for (const post of fresh) {
        seen.add(post.uri)
        const local = byUri.get(post.uri) || (post.cid ? byUri.get(post.cid) : undefined)
        // Some adapters name the field createdAt; fall back to the local
        // publish time for posts this app made.
        const postedAt = post.postedAt || (post as { createdAt?: string }).createdAt || local?.postedAt
        if (cutoff && !isOlderThan(postedAt, cutoff)) continue
        collected.push({
          uri: post.uri,
          cid: post.cid,
          text: post.text,
          postedAt,
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
  /** Deletions this account made on a network in the last 24 hours, from the run log. */
  private async deletedInLastDay(provider: SocialProvider, handle: string | null): Promise<number> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
    let query = database.selectFrom('purge_runs').select(['deleted_count'])
      .where('provider', '=', provider)
      .where('mode', '=', 'execute')
      .where('created_at', '>=', since)
    if (handle) query = query.where('handle', '=', handle)
    const rows = await query.execute()
    return rows.reduce((total: number, row: { deleted_count: unknown }) => total + (Number(row.deleted_count) || 0), 0)
  }

  private async recordRun(
    result: PurgeProviderResult,
    context: RunContext,
    status: 'previewed' | 'completed' | 'partial' | 'failed' | 'skipped',
    failureReason?: string,
  ): Promise<void> {
    const { scope, dryRun } = context
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
          trigger: context.trigger,
          olderThanDays: context.olderThanDays,
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
