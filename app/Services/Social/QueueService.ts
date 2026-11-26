import { log } from '@stacksjs/logging'
import { mediaObjections } from '../../Support/Social/media-rules'
import type { PostOptions } from '../../Support/Social/post-options'
import type { ScheduledSelection, ScheduleDestination } from '../../Support/Social/rescheduling'
import type { StoredContent } from '../../Support/Social/stored-content'
import { sanitizePostOptions } from '../../Support/Social/post-options'
import { isDue, MAX_ATTEMPTS, nextAttemptAt } from '../../Support/Social/retry'
import { moveScheduledTime } from '../../Support/Social/rescheduling'
import type { PublishTarget } from '../../Support/Social/targets'
import type { CrosspostService } from './CrosspostService'
import type { CrosspostTargetResult, PublishContent, SocialProvider } from '../../Support/Social/types'
import type { VariantMap } from '../../Support/Social/variants'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { raw } from '@stacksjs/query-builder'
import { UserFacingError } from '../../Support/Http/user-error'
import { dedupeTargets, isAccountProvider, parseTargets, targetKey, targetProviders } from '../../Support/Social/targets'
import { parseStoredContent } from '../../Support/Social/stored-content'
import { isSafeMediaFilename, MEDIA_DIR, publicMediaUrl } from '../../Support/Social/uploads'
import { resolveStoredVariants, sanitizeVariants } from '../../Support/Social/variants'
import { crosspost, crosspostProviders } from './CrosspostService'
import { findIdentityRow, unavailableAccountError } from './identities'
import { isRealTimestamp } from '../../Support/time'
import { alerts } from '../AlertService'
import { workspace } from '../WorkspaceService'
import { ensureAccount, now, uuid } from './support'

const database = db as any

/**
 * The `posts` column that holds `StoredContent`: `content`.
 *
 * For a while there was no such column. A hand-written migration had added
 * it, the model never declared it, and a schema regenerated from the models
 * lost it, so the queue kept its JSON in `notes` instead. The model declares
 * `content` now. Rows written in between still have their JSON in `notes`,
 * and are moved across once, the first time the queue is used after an
 * upgrade.
 */
let legacyContentMoved: Promise<void> | null = null

async function contentColumn(): Promise<'content'> {
  legacyContentMoved ??= moveLegacyContent().catch((error) => {
    // Try again on the next call instead of pinning a failure for the
    // lifetime of the process.
    legacyContentMoved = null
    throw error
  })
  await legacyContentMoved
  return 'content'
}

/**
 * Move stored content that was parked in `notes` into `content`. Only rows
 * whose `notes` is the queue's own JSON are touched: a note somebody wrote
 * stays a note.
 */
async function moveLegacyContent(): Promise<void> {
  const parked = await database
    .selectFrom('posts')
    .select(['id', 'notes'])
    .where('content', 'is', null)
    .where('notes', 'like', '{%')
    .execute()

  for (const row of parked) {
    if (!parseStoredContent(row.notes)) continue
    await database.updateTable('posts').set({ content: row.notes, notes: null }).where('id', '=', row.id).execute()
  }
}

/** For tests: forget that the move has run. */
export function resetLegacyContentMove(): void {
  legacyContentMoved = null
}

/** The stored-content value of a `posts` row read with `selectAll()`. */
async function storedContentOf(post: any): Promise<unknown> {
  return post?.[await contentColumn()]
}

/** Posts per page of the queue, and the most one request may ask for. */
export const QUEUE_PAGE_SIZE = 50
export const MAX_QUEUE_PAGE_SIZE = 500

/** Network names as the owner reads them, for alerts. */
const NETWORK_NAMES: Record<string, string> = { bluesky: 'Bluesky', twitter: 'X', mastodon: 'Mastodon', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads', blog: 'the blog' }

const ACTIONABLE = new Set(['draft', 'scheduled', 'failed'])

/**
 * How long a post may sit in `publishing` before it is taken to be stranded:
 * the process that claimed it stopped before finishing. Far longer than any
 * publish takes, so a slow network is never mistaken for a dead process.
 */
export const STRANDED_AFTER_MINUTES = 15

export const STRANDED_REASON = 'Postline stopped while this was being sent. Check the network before retrying: it may have gone out.'

/**
 * How late a scheduled post may be and still go out by itself. A post that is
 * later than this was missed: Postline was not running when it was due. A
 * week of missed posts must not all fire the moment a laptop is opened.
 */
export const LATE_GRACE_MINUTES = Number(process.env.POSTLINE_LATE_GRACE_MINUTES) > 0
  ? Number(process.env.POSTLINE_LATE_GRACE_MINUTES)
  : 30

export const MISSED_PREFIX = 'Missed:'

function missedReason(scheduledAt: string): string {
  return `${MISSED_PREFIX} Postline was not running when this was due (${scheduledAt} UTC). Publish it now, or give it a new time.`
}

/**
 * Refuse an image that one of the post's networks will not take, now and by
 * name, instead of letting it fail on that network at publish time. An image
 * given by address is not in hand and is not measured.
 */
function assertMediaAllowed(providers: string[], images: QueueImage[] | undefined): void {
  if (!images?.length) return
  const objections = mediaObjections(providers, images.map(image => image.bytes?.length ? { bytes: image.bytes.length, mimeType: image.mimeType } : {}))
  if (objections.length)
    throw new UserFacingError(`${objections.join(' ')} Use a different image, or leave that network out.`)
}

/**
 * Write each uploaded image to the media folder and describe all of them for
 * the stored content. An image given by address is kept as its address.
 */
async function storeImages(postUuid: string, images: QueueImage[]): Promise<NonNullable<StoredContent['media']>> {
  const media: NonNullable<StoredContent['media']> = []
  for (const image of images) {
    if (image.bytes?.length) {
      const extension = (image.mimeType || 'image/jpeg').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg'
      const filename = `${postUuid}-${uuid().slice(0, 8)}.${extension}`
      await mkdir(MEDIA_DIR, { recursive: true })
      await Bun.write(join(MEDIA_DIR, filename), image.bytes)
      media.push({ path: filename, mimeType: image.mimeType, altText: image.altText })
    }
    else if (image.url) {
      media.push({ url: image.url, altText: image.altText })
    }
  }
  return media
}

/** Thrown when a queued post's attached image is no longer on disk. */
export class MissingMediaError extends UserFacingError {
  constructor() {
    super('The image attached to this post is missing, so it was not sent. Attach it again, or remove it from the post.')
  }
}

/** Thrown when a post is already being published by another run. */
export class AlreadyPublishingError extends UserFacingError {
  constructor() {
    super('This post is already being published.')
  }
}

/** How many rows a write changed, whichever shape the query builder reports it in. */
function affected(result: unknown): number {
  if (typeof result === 'number' || typeof result === 'bigint')
    return Number(result)
  const count = (result as { numUpdatedRows?: number | bigint } | undefined)?.numUpdatedRows
  return count === undefined ? 0 : Number(count)
}

export interface QueueTargetView {
  provider: SocialProvider
  /** The account it goes (or went) out through; null means the network default. */
  identityId: number | null
  /** That account's handle, for telling two accounts on one network apart. */
  handle: string | null
  /** The target spec (`bluesky:12`, or `blog`). */
  target: string
  status: string
  remoteUri: string | null
  failureReason: string | null
  /** Sends that have failed so far. */
  attempts: number
  /** When Postline sends it again by itself, as an ISO time; null when it will not. */
  nextAttemptAt: string | null
}

export interface QueueItemView {
  id: number
  title: string | null
  body: string
  status: string
  scheduledAt: string | null
  publishedAt: string | null
  createdAt: string
  providers: QueueTargetView[]
  hasImage: boolean
  hasLink: boolean
  /**
   * True for a post that went out on some networks and failed on others. Its
   * failed networks can be sent again on their own with "publish now".
   */
  partial: boolean
  /**
   * For a segment of a thread: where it sits, and the segment a resume would
   * start from (the first one that did not go out somewhere), or null when
   * every segment went out everywhere (#100).
   */
  thread: { position: number, length: number, resumeFrom: number | null } | null
}

interface ScheduledRow {
  id: number
  status: string
  scheduled_at: string | null
  thread_key: string | null
}

export interface SaveQueueInput {
  text: string
  /**
   * Where it goes: network names (`bluesky`, the network's default account at
   * publish time) and/or account target specs (`bluesky:12`). Campaigns pass
   * bare network names; the composer passes specs.
   */
  providers: readonly string[]
  /** Explicit title for long-form targets (blog). */
  title?: string | null
  /** UTC `YYYY-MM-DD HH:MM:SS`; omitted → saved as a draft. */
  scheduledAt?: string | null
  external?: { uri: string, title: string, description?: string } | null
  /** One attached image: raw bytes (stored to disk until publish) or a URL. */
  image?: QueueImage | null
  /** Several images, in order, up to four. Wins over `image` when given. */
  images?: QueueImage[] | null
  /** Language and Mastodon options. On an edit, undefined keeps what is stored. */
  options?: PostOptions | null
  /** Per-provider body overrides; providers without one publish `text`. */
  variants?: VariantMap | null
}

/**
 * Edit input. The images and `variants` are tri-state: undefined keeps what
 * is stored, null (or an empty list) clears it, a value replaces it.
 */
export type UpdateQueueInput = SaveQueueInput

/** An image on a queued post. */
export interface QueueImage {
  bytes?: Uint8Array
  url?: string
  mimeType?: string
  altText?: string
}

/** The most images a post carries: the most any network takes. */
export const MAX_POST_IMAGES = 4

/** The images an input names. Undefined keeps what is stored; an empty list removes it. */
function imagesOf(input: { image?: QueueImage | null, images?: QueueImage[] | null }): QueueImage[] | undefined {
  const usable = (image: QueueImage | null | undefined): image is QueueImage => Boolean(image && (image.bytes?.length || image.url))
  if (input.images !== undefined) {
    const images = (input.images ?? []).filter(usable)
    if (images.length > MAX_POST_IMAGES)
      throw new UserFacingError(`A post can carry up to ${MAX_POST_IMAGES} images; this one has ${images.length}.`)
    return images
  }
  if (input.image === undefined) return undefined
  return usable(input.image) ? [input.image] : []
}

/** Editable snapshot of a queued post for prefilling the composer. */
export interface QueueEditView {
  id: number
  text: string
  title: string | null
  status: string
  scheduledAt: string | null
  /** The distinct networks, for callers that only care which networks. */
  providers: SocialProvider[]
  /** The exact targets, as specs, so an edit preselects the same accounts. */
  targets: string[]
  external: { uri: string, title: string, description?: string } | null
  /** The first image, as before. */
  image: { kind: 'file' | 'url', url: string | null } | null
  /** Every image, in order, with its alt text. */
  images: Array<{ kind: 'file' | 'url', url: string | null, altText: string | null }>
  /** Per-provider overrides, so an edit round-trips them instead of dropping them. */
  variants: VariantMap | null
  options: PostOptions | null
}

export class QueueService {
  /**
   * The crosspost service is injectable so tests can publish through fake
   * networks, which is the only way to exercise two runs racing for one post.
   */
  constructor(private publisher: Pick<CrosspostService, 'publishExisting' | 'resumeThread'> = crosspost) {}

  /**
   * Persist a post without publishing it. With `scheduledAt` the post is
   * queued (`scheduled`) and picked up by the PublishScheduledPosts job when
   * due; without it the post is stored as a `draft`. One placeholder
   * `post_targets` row per target records where the post should go — network
   * and, when one was chosen, account — and the real result rows replace them
   * at publish time.
   */
  async save(input: SaveQueueInput): Promise<{ postId: number, status: 'draft' | 'scheduled', scheduledAt: string | null }> {
    const body = input.text.trim()
    if (!body)
      throw new Error('Post text is required.')

    const targets = await this.validTargets(input.providers)
    const images = imagesOf(input)
    assertMediaAllowed(targets.map(target => target.provider), images)

    const scheduledAt = input.scheduledAt?.trim() || null
    if (scheduledAt) {
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(scheduledAt))
        throw new Error('Scheduled time must be a UTC YYYY-MM-DD HH:MM:SS timestamp.')
      if (!isRealTimestamp(scheduledAt))
        throw new UserFacingError('That date or time does not exist. Check the day and the hour.')
      if (scheduledAt <= now())
        throw new Error('Scheduled time must be in the future.')
    }

    const status = scheduledAt ? 'scheduled' as const : 'draft' as const
    const accountId = await ensureAccount()
    const postUuid = uuid()
    const createdAt = now()

    const stored: StoredContent = {}
    if (input.title?.trim()) stored.title = input.title.trim()
    if (input.external?.uri && input.external.title) stored.external = input.external
    const savedVariants = sanitizeVariants(input.variants)
    if (savedVariants) stored.variants = savedVariants
    const savedOptions = sanitizePostOptions(input.options)
    if (savedOptions) stored.options = savedOptions
    if (images?.length) stored.media = await storeImages(postUuid, images)

    await database.insertInto('posts').values({
      uuid: postUuid,
      title: input.title?.trim() || body.slice(0, 80),
      body,
      status,
      [await contentColumn()]: Object.keys(stored).length ? JSON.stringify(stored) : null,
      scheduled_at: scheduledAt,
      timezone: await workspace.timezone(),
      source: 'composer',
      account_id: accountId,
      created_at: createdAt,
      updated_at: createdAt,
    }).execute()

    const post = await database
      .selectFrom('posts')
      .select(['id'])
      .where('uuid', '=', postUuid)
      .executeTakeFirstOrThrow()

    await this.writePlaceholders(Number(post.id), targets, status, scheduledAt, createdAt)

    return { postId: Number(post.id), status, scheduledAt }
  }

  /**
   * Schedule a thread (#255): one post per segment, sharing a thread key,
   * each with the same targets and time. When it comes due the scheduler
   * sends the segments once, in order, as replies (publishNow, below).
   */
  async saveThread(input: { texts: readonly string[], providers: readonly string[], scheduledAt: string, options?: SaveQueueInput['options'] }): Promise<{ postIds: number[], status: 'scheduled', scheduledAt: string }> {
    const segments = input.texts.map(text => String(text).trim()).filter(Boolean)
    if (segments.length < 2) throw new UserFacingError('A thread needs at least two posts.')
    const targets = await this.validTargets(input.providers)

    const scheduledAt = input.scheduledAt.trim()
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(scheduledAt))
      throw new Error('Scheduled time must be a UTC YYYY-MM-DD HH:MM:SS timestamp.')
    if (!isRealTimestamp(scheduledAt))
      throw new UserFacingError('That date or time does not exist. Check the day and the hour.')
    if (scheduledAt <= now())
      throw new UserFacingError('Pick a time in the future.')

    const accountId = await ensureAccount()
    const threadKey = uuid()
    const options = sanitizePostOptions(input.options)
    const column = await contentColumn()
    const timezone = await workspace.timezone()
    const postIds: number[] = []
    for (const body of segments) {
      const postUuid = uuid()
      const createdAt = now()
      await database.insertInto('posts').values({
        uuid: postUuid,
        title: body.slice(0, 80),
        body,
        status: 'scheduled',
        [column]: options ? JSON.stringify({ options }) : null,
        scheduled_at: scheduledAt,
        timezone,
        source: 'composer',
        thread_key: threadKey,
        account_id: accountId,
        created_at: createdAt,
        updated_at: createdAt,
      }).execute()
      const post = await database.selectFrom('posts').select(['id']).where('uuid', '=', postUuid).executeTakeFirstOrThrow()
      postIds.push(Number(post.id))
      await this.writePlaceholders(Number(post.id), targets, 'scheduled', scheduledAt, createdAt)
    }
    return { postIds, status: 'scheduled', scheduledAt }
  }

  /** Recent posts with their per-provider targets, newest first. */
  async list(limit = QUEUE_PAGE_SIZE): Promise<QueueItemView[]> {
    return (await this.listPage({ limit })).items
  }

  /**
   * One page of the queue, newest first, and the cursor for the page after
   * it. The list used to stop at fifty posts with nothing to say there were
   * more. Paged by id, which never changes and is in creation order, so a
   * post added while the owner scrolls cannot shift or repeat a row.
   */
  async listPage(options: { before?: number | null, limit?: number, search?: string, calendar?: { from: string, to: string } } = {}): Promise<{ items: QueueItemView[], nextCursor: number | null }> {
    const limit = Math.min(MAX_QUEUE_PAGE_SIZE, Math.max(1, Math.floor(Number(options.limit) || QUEUE_PAGE_SIZE)))
    // Before any row is read: content an older version parked in `notes`
    // has to be in place first.
    await contentColumn()
    let query = database
      .selectFrom('posts')
      .selectAll()
      .where('status', '!=', 'archived')
    if (options.before) query = query.where('id', '<', Number(options.before))
    if (options.calendar) {
      // The caller groups by its workspace time zone. Include the adjacent
      // UTC dates so the range covers local days at either end of the offset.
      const from = new Date(Date.parse(options.calendar.from) - 86_400_000).toISOString().slice(0, 10) + ' 00:00:00'
      const to = new Date(Date.parse(options.calendar.to) + 86_400_000).toISOString().slice(0, 10) + ' 00:00:00'
      query = query.whereRaw(raw`COALESCE(scheduled_at, published_at) >= ${from} AND COALESCE(scheduled_at, published_at) < ${to}`)
    }
    const search = options.search?.trim().slice(0, 200)
    if (search) {
      const pattern = `%${search.replace(/[!%_]/g, character => `!${character}`)}%`
      query = query.whereRaw(raw`(
        lower(body) LIKE lower(${pattern}) ESCAPE '!'
        OR lower(title) LIKE lower(${pattern}) ESCAPE '!'
        OR EXISTS (
          SELECT 1 FROM json_each(CASE WHEN json_valid(content) THEN json_extract(content, '$.variants') END)
          WHERE type = 'text' AND lower(value) LIKE lower(${pattern}) ESCAPE '!'
        )
      )`)
    }

    // One more than asked for: its presence is how we know there is a next page.
    const fetched = await query.orderBy('id', 'desc').limit(limit + 1).execute()
    const posts = fetched.slice(0, limit)
    const nextCursor = fetched.length > limit ? Number(posts[posts.length - 1].id) : null

    if (posts.length === 0)
      return { items: [], nextCursor: null }

    const targets = await database
      .selectFrom('post_targets')
      .selectAll()
      .where('post_id', 'in', posts.map((post: any) => post.id))
      .execute()

    // Handles for the accounts these targets name — disconnected ones included,
    // since a published post still went out through them.
    const identityIds = [...new Set(targets.map((target: any) => Number(target.social_identity_id)).filter(Boolean))]
    const identities = identityIds.length
      ? await database.selectFrom('social_identities').select(['id', 'handle']).where('id', 'in', identityIds).execute()
      : []
    const handles = new Map<number, string>(identities.map((row: any) => [Number(row.id), String(row.handle)]))

    // Threads on this page: each segment's position, and where a resume
    // would start, from every segment of the thread (not only this page's).
    const threadKeys = [...new Set(posts.map((post: any) => post.thread_key).filter(Boolean))]
    const threadInfo = new Map<string, { ids: number[], resumeFrom: number | null }>()
    if (threadKeys.length) {
      const segments = await database.selectFrom('posts').select(['id', 'thread_key']).where('thread_key', 'in', threadKeys).orderBy('id', 'asc').execute()
      const segmentTargets = segments.length
        ? await database.selectFrom('post_targets').select(['post_id', 'status']).where('post_id', 'in', segments.map((row: any) => row.id)).execute()
        : []
      for (const key of threadKeys) {
        const ids = segments.filter((row: any) => row.thread_key === key).map((row: any) => Number(row.id))
        const first = ids.findIndex((id: number) => segmentTargets.some((target: any) => Number(target.post_id) === id && target.status === 'failed'))
        threadInfo.set(String(key), { ids, resumeFrom: first === -1 ? null : first + 1 })
      }
    }

    const column = await contentColumn()
    const items = posts.map((post: any): QueueItemView => {
      const stored = parseStoredContent(post[column])
      return {
        id: Number(post.id),
        title: post.title || null,
        body: String(post.body || ''),
        status: String(post.status),
        scheduledAt: post.scheduled_at || null,
        publishedAt: post.published_at || null,
        createdAt: String(post.created_at),
        hasImage: Boolean(stored?.media?.length),
        hasLink: Boolean(stored?.external),
        partial: String(post.status) === 'published'
          && targets.some((target: any) => Number(target.post_id) === Number(post.id) && target.status === 'failed'),
        thread: post.thread_key && threadInfo.has(String(post.thread_key))
          ? {
              position: threadInfo.get(String(post.thread_key))!.ids.indexOf(Number(post.id)) + 1,
              length: threadInfo.get(String(post.thread_key))!.ids.length,
              resumeFrom: threadInfo.get(String(post.thread_key))!.resumeFrom,
            }
          : null,
        providers: targets
          .filter((target: any) => Number(target.post_id) === Number(post.id))
          .map((target: any): QueueTargetView => {
            const identityId = Number(target.social_identity_id) || null
            return {
              provider: target.provider,
              identityId,
              handle: identityId ? handles.get(identityId) || null : null,
              target: targetKey({ provider: target.provider, identityId }),
              status: String(target.status),
              remoteUri: target.remote_uri || null,
              failureReason: target.failure_reason || null,
              attempts: Number(target.attempts) || 0,
              nextAttemptAt: target.status === 'failed' && target.next_attempt_at ? `${String(target.next_attempt_at).replace(' ', 'T')}Z` : null,
            }
          }),
      }
    })

    return { items, nextCursor }
  }

  /** Delete a draft, scheduled, or failed post along with its targets. */
  async remove(id: number): Promise<void> {
    const post = await this.findActionable(id)
    await database.deleteFrom('post_targets').where('post_id', '=', post.id).execute()
    await database.deleteFrom('posts').where('id', '=', post.id).execute()
    await this.removeStoredMedia(post)
  }

  /**
   * Full editable state for one draft/scheduled/failed post, for prefilling
   * the composer. Media is described (present/kind), not returned as bytes —
   * the composer keeps the existing image unless the user replaces/removes it.
   */
  async get(id: number): Promise<QueueEditView> {
    const post = await this.findActionable(id)
    const stored = parseStoredContent(await storedContentOf(post))
    const rows = await database
      .selectFrom('post_targets')
      .select(['provider', 'social_identity_id'])
      .where('post_id', '=', post.id)
      .execute()
    const targets = targetsOf(rows)

    const media = stored?.media?.[0]
    return {
      id: Number(post.id),
      text: String(post.body || ''),
      title: stored?.title || null,
      status: String(post.status),
      scheduledAt: post.scheduled_at || null,
      providers: targetProviders(targets),
      targets: targets.map(targetKey),
      external: stored?.external || null,
      image: media ? { kind: media.path ? 'file' : 'url', url: media.url || null } : null,
      images: (stored?.media || []).map(item => ({ kind: item.path ? 'file' as const : 'url' as const, url: item.url || null, altText: item.altText || null })),
      variants: sanitizeVariants(stored?.variants) || null,
      options: sanitizePostOptions(stored?.options) || null,
    }
  }

  /**
   * Update a draft/scheduled/failed post in place: text, title, providers,
   * schedule, link card, and image. `image` semantics — undefined keeps the
   * existing media, null removes it, an object replaces it. Placeholder
   * targets are rebuilt to match the new target set.
   */
  async update(id: number, input: UpdateQueueInput): Promise<{ postId: number, status: 'draft' | 'scheduled' }> {
    const post = await this.findActionable(id)

    const body = input.text.trim()
    if (!body)
      throw new Error('Post text is required.')

    const targets = await this.validTargets(input.providers)
    const images = imagesOf(input)
    assertMediaAllowed(targets.map(target => target.provider), images)

    const scheduledAt = input.scheduledAt?.trim() || null
    if (scheduledAt) {
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(scheduledAt))
        throw new Error('Scheduled time must be a UTC YYYY-MM-DD HH:MM:SS timestamp.')
      if (!isRealTimestamp(scheduledAt))
        throw new UserFacingError('That date or time does not exist. Check the day and the hour.')
      if (scheduledAt <= now())
        throw new Error('Scheduled time must be in the future.')
    }

    const status = scheduledAt ? 'scheduled' as const : 'draft' as const
    const column = await contentColumn()
    const existing = parseStoredContent(post[column])
    const stored: StoredContent = {}
    if (input.title?.trim()) stored.title = input.title.trim()
    if (input.external?.uri && input.external.title) stored.external = input.external

    // Variants: replace / clear / keep, mirroring the media tri-state below.
    const updatedVariants = resolveStoredVariants(input.variants, existing?.variants)
    if (updatedVariants) stored.variants = updatedVariants
    const updatedOptions = input.options === undefined ? sanitizePostOptions(existing?.options) : sanitizePostOptions(input.options)
    if (updatedOptions) stored.options = updatedOptions

    // Media: replace / remove / keep. Replacing or removing drops the old files.
    if (images !== undefined) {
      if (images.length) stored.media = await storeImages(String(post.uuid), images)
    }
    else if (existing?.media?.length) {
      stored.media = existing.media
    }

    const updatedAt = now()
    await database.updateTable('posts').set({
      title: input.title?.trim() || body.slice(0, 80),
      body,
      status,
      [column]: Object.keys(stored).length ? JSON.stringify(stored) : null,
      scheduled_at: scheduledAt,
      updated_at: updatedAt,
    }).where('id', '=', post.id).execute()

    // Rebuild placeholder targets to match the new target set.
    await database.deleteFrom('post_targets').where('post_id', '=', post.id).execute()
    await this.writePlaceholders(Number(post.id), targets, status, scheduledAt, updatedAt)
    if (images !== undefined) await this.removeStoredMedia(post)

    return { postId: Number(post.id), status }
  }

  /** Apply the entire selection or leave its schedule untouched. */
  async reschedule(selection: readonly ScheduledSelection[], destination: ScheduleDestination): Promise<{ count: number }> {
    const timeZone = await workspace.timezone()
    return database.transaction((tx: typeof database) => {
      const at = now()
      const selected = tx.selectFrom('posts').select(['id', 'status', 'scheduled_at', 'thread_key'])
        .where('id', 'in', selection.map(post => post.id)).execute() as ScheduledRow[]
      const byId = new Map(selected.map(post => [Number(post.id), post]))
      const moves = new Map<number, string>()
      const threads = new Map<string, string>()
      const scheduleChanged = () => new UserFacingError('The queue changed. Refresh the list and select the scheduled posts again.', 'queue_schedule_changed')

      for (const { id, scheduledAt } of selection) {
        const post = byId.get(id)
        if (!post || post.status !== 'scheduled' || !post.scheduled_at) throw scheduleChanged()
        const next = moveScheduledTime(scheduledAt, destination, timeZone)
        if (next <= at) throw new UserFacingError('All the new scheduled times must be in the future.')
        if (post.scheduled_at !== scheduledAt && post.scheduled_at !== next) throw scheduleChanged()

        if (!post.thread_key) {
          moves.set(id, next)
          continue
        }
        const threadTime = threads.get(post.thread_key)
        if (threadTime && threadTime !== next)
          throw new UserFacingError('Select one segment to move a thread with different scheduled times.')
        if (threadTime) continue
        threads.set(post.thread_key, next)
        const segments = tx.selectFrom('posts').select(['id', 'status', 'scheduled_at'])
          .where('thread_key', '=', post.thread_key).execute() as ScheduledRow[]
        if (segments.some(segment => segment.status !== 'scheduled' || !segment.scheduled_at)) throw scheduleChanged()
        for (const segment of segments) moves.set(Number(segment.id), next)
      }

      for (const [id, scheduledAt] of moves) {
        const values = { scheduled_at: scheduledAt, updated_at: at }
        tx.updateTable('posts').set(values).where('id', '=', id).execute()
        tx.updateTable('post_targets').set(values).where('post_id', '=', id).where('status', '=', 'scheduled').execute()
      }
      return { count: moves.size }
    })
  }

  /**
   * Narrow submitted targets to ones that can be queued: known networks, and
   * accounts that exist on that network and are still connected.
   *
   * A disconnected account is refused here rather than at publish time so the
   * user hears about it while they are still looking at the post — a schedule
   * that silently fails next Tuesday is the worse outcome. An account that only
   * needs reconnecting is accepted: there is time to fix it before it is due.
   */
  private async validTargets(raw: readonly string[]): Promise<PublishTarget[]> {
    const targets = parseTargets([...raw], crosspostProviders())
    if (targets.length === 0)
      throw new Error('Select at least one connected provider.')

    for (const target of targets) {
      if (!target.identityId) continue
      const row = await findIdentityRow(target.provider, target.identityId)
      if (!row || row.auth_status === 'revoked')
        throw unavailableAccountError(providerName(target.provider), row)
    }

    return targets
  }

  /** One placeholder `post_targets` row per target, carrying its account. */
  private async writePlaceholders(
    postId: number,
    targets: readonly PublishTarget[],
    status: 'draft' | 'scheduled',
    scheduledAt: string | null,
    at: string,
  ): Promise<void> {
    for (const target of targets) {
      await database.insertInto('post_targets').values({
        uuid: uuid(),
        provider: target.provider,
        social_identity_id: target.identityId,
        status,
        scheduled_at: scheduledAt,
        post_id: postId,
        created_at: at,
        updated_at: at,
      }).execute()
    }
  }

  /**
   * Take a post for publishing, or fail if another run already has.
   *
   * Reading the status and then writing `publishing` is two steps, and two
   * runs can both pass the first before either does the second: the
   * scheduler's next tick, a "publish now" click, a second process. Both then
   * publish. So the claim is one statement that only changes a row still in
   * an actionable state, and the answer to "did I get it" is whether that
   * statement changed a row. SQLite runs one write at a time, so exactly one
   * caller sees 1.
   */
  private async claim(post: { id: number | string, status: string }, expectedScheduledAt?: string): Promise<void> {
    // From the exact state that was read: anything else means another run
    // moved the post in between.
    let claim = database.updateTable('posts').set({
      status: 'publishing',
      updated_at: now(),
    }).where('id', '=', post.id).where('status', '=', post.status)
    if (expectedScheduledAt) claim = claim.where('scheduled_at', '=', expectedScheduledAt)
    const changed = affected(await claim.execute())

    if (changed !== 1)
      throw new AlreadyPublishingError()
  }

  /**
   * Publish a draft, scheduled or failed post immediately. Also sends the
   * failed networks of a post that went out elsewhere: only targets still
   * pending or failed are published, so a network that already has the post
   * never gets it twice.
   */
  async publishNow(id: number, options: { retriesOnly?: boolean, expectedScheduledAt?: string } = {}): Promise<{ postId: number, results: CrosspostTargetResult[] }> {
    const expected = options.expectedScheduledAt
    const post = await this.findPublishable(id, expected)
    // A segment of a thread is never sent on its own: it would land outside
    // the thread. A scheduled thread is claimed whole and sent in order; one
    // that went out in part resumes from where each account stopped (#100, #255).
    if (post.thread_key) {
      const threadKey = String(post.thread_key)
      if (String(post.status) === 'scheduled' || String(post.status) === 'draft') {
        const claimed = await database.transaction((tx: typeof database) => {
          if (expected && !tx.selectFrom('posts').select('id').where('id', '=', post.id)
            .where('status', '=', 'scheduled').where('scheduled_at', '=', expected).executeTakeFirst())
            return 0
          return affected(tx.updateTable('posts').set({ status: 'publishing', updated_at: now() })
            .where('thread_key', '=', threadKey).where('status', 'in', ['scheduled', 'draft']).execute())
        })
        if (claimed === 0) throw new AlreadyPublishingError()
      }
      const { results } = await this.publisher.resumeThread(threadKey)
      // A segment still marked publishing did not go out anywhere.
      await database.updateTable('posts').set({ status: 'failed', updated_at: now() })
        .where('thread_key', '=', threadKey).where('status', '=', 'publishing').execute()
      return { postId: Number(post.id), results }
    }
    const wasPublished = String(post.status) === 'published'
    // Read before the claim: a post whose image is gone is refused here, with
    // nothing changed, instead of being claimed and then failing halfway.
    const content = await this.hydrateContent(post)
    await this.claim(post, expected)

    const pending: any[] = await database
      .selectFrom('post_targets')
      .selectAll()
      .where('post_id', '=', post.id)
      .where('status', 'in', ['draft', 'scheduled', 'failed'])
      .execute()
    // An automatic retry sends only the networks whose wait is over. One
    // that was refused, or is still waiting, is left exactly as it is.
    const placeholders = options.retriesOnly
      ? pending.filter(row => row.status === 'failed' && isDue(row.next_attempt_at))
      : pending

    // How many sends each target has had, carried across this one: the
    // provider services write fresh rows, which start again from nothing.
    const attemptsBefore = new Map<string, number>(
      placeholders.map((row: any) => [recordKey(row.provider, row.social_identity_id), Number(row.attempts) || 0]),
    )

    // De-duplicated per account, not per network: two Bluesky accounts on one
    // post are two targets and both publish.
    const targets = targetsOf(placeholders)
    if (targets.length === 0) {
      // Nothing to send: hand the post back as it was.
      await database.updateTable('posts').set({ status: post.status, updated_at: now() }).where('id', '=', post.id).execute()
      throw new Error('This post has no pending targets to publish.')
    }

    // The placeholders are kept, marked `publishing`, until the results are
    // in. They used to be deleted here, which meant a process that stopped
    // mid-publish left a post with no record of where it had been going and
    // no way to retry it. `recoverStranded` reads them.
    const placeholderIds = new Set<number>(placeholders.map((target: any) => Number(target.id)))
    for (const target of placeholders) {
      await database.updateTable('post_targets').set({ status: 'publishing', updated_at: now() }).where('id', '=', target.id).execute()
    }

    const results = await this.publisher.publishExisting(
      { id: Number(post.id), body: String(post.body) },
      targets,
      content,
    )

    const anyOk = results.some(result => result.ok)
    const finishedAt = now()

    // Providers that reject before reaching their own insert — an over-limit
    // body is checked first in every service — write no result row. Their
    // placeholder is already gone, so without this the target would vanish from
    // the queue entirely: no row, no failure reason, and the post still marked
    // published because some other network succeeded. Matched per account, so
    // one Bluesky account's row does not hide another's missing one.
    // The provider services insert fresh result rows, so the placeholders have
    // done their job.
    if (placeholderIds.size)
      await database.deleteFrom('post_targets').where('id', 'in', [...placeholderIds]).execute()

    const written = await database
      .selectFrom('post_targets')
      .select(['provider', 'social_identity_id'])
      .where('post_id', '=', post.id)
      .execute()
    const recorded = new Set(written.map((row: any) => recordKey(row.provider, row.social_identity_id)))
    for (const result of results) {
      if (recorded.has(recordKey(result.provider, result.identityId))) continue
      await database.insertInto('post_targets').values({
        uuid: uuid(),
        provider: result.provider,
        social_identity_id: result.identityId || null,
        status: 'failed',
        failure_reason: result.error || 'Publishing failed.',
        post_id: post.id,
        created_at: finishedAt,
        updated_at: finishedAt,
      }).execute()
    }

    // Count the send on every network that failed, and say when it goes again.
    // A manual "publish now" counts too, so a network that keeps failing
    // stops being retried whoever was pressing the button.
    for (const result of results) {
      if (result.ok) continue
      const attempts = (attemptsBefore.get(recordKey(result.provider, result.identityId)) ?? 0) + 1
      const next = nextAttemptAt(result.retry, attempts)
      let failedRows = database.updateTable('post_targets')
        .set({ attempts, next_attempt_at: next })
        .where('post_id', '=', post.id)
        .where('provider', '=', result.provider)
        .where('status', '=', 'failed')
      failedRows = result.identityId
        ? failedRows.where('social_identity_id', '=', result.identityId)
        : failedRows.where('social_identity_id', 'is', null)
      await failedRows.execute()
      if (next) {
        log.info(`[postline] post ${post.id} will be sent to ${result.target || result.provider} again at ${next} UTC (attempt ${attempts + 1} of ${MAX_ATTEMPTS})`)
      }
      else {
        // Nothing will send this again: it is the owner's now, so tell them.
        await alerts.raise({
          kind: 'post-failed',
          title: `A post failed on ${NETWORK_NAMES[result.provider] || result.provider}${result.handle ? ` (${result.handle})` : ''}`,
          body: `${result.error || 'No reason was given.'} The post: "${String(post.body).replace(/\s+/g, ' ').trim().slice(0, 120)}"`,
          link: '/queue',
          key: `post-failed:${post.id}:${recordKey(result.provider, result.identityId)}:${attempts}`,
        })
      }
    }

    for (const result of results) {
      if (result.ok)
        log.info(`[postline] post ${post.id} published to ${result.target || result.provider}`)
      else
        log.warn(`[postline] post ${post.id} failed on ${result.target || result.provider}: ${result.error || 'no reason given'}`)
    }

    // A retry of a post that already went out somewhere leaves it published
    // whatever the retry did, and keeps the time it first went out.
    const published = anyOk || wasPublished
    await database.updateTable('posts').set({
      status: published ? 'published' : 'failed',
      ...(published && !post.published_at ? { published_at: finishedAt } : {}),
      updated_at: finishedAt,
    }).where('id', '=', post.id).execute()

    // The image is kept while any network still needs it. It used to be
    // removed as soon as one network succeeded, which left a failed network
    // with nothing to retry with.
    const stillFailed = await database
      .selectFrom('post_targets')
      .select(['id'])
      .where('post_id', '=', post.id)
      .where('status', '=', 'failed')
      .execute()
    if (published && stillFailed.length === 0) await this.removeStoredMedia(post)

    return { postId: Number(post.id), results }
  }

  /** Rebuild PublishContent from a queued post's stored content JSON. */
  private async hydrateContent(post: any): Promise<PublishContent | undefined> {
    const stored = parseStoredContent(await storedContentOf(post))
    if (!stored) return undefined

    const content: PublishContent = {}
    if (stored.title) content.title = stored.title
    if (stored.external) content.external = stored.external
    // Re-sanitized on read: posts.content is free-form JSON, so a hand-edited
    // or stale row must not reach the publish path unchecked.
    const variants = sanitizeVariants(stored.variants)
    if (variants) content.variants = variants
    const options = sanitizePostOptions(stored.options)
    if (options) content.options = options

    if (stored.media?.length) {
      const media: NonNullable<PublishContent['media']> = []
      for (const item of stored.media) {
        if (item.path) {
          if (!isSafeMediaFilename(item.path)) throw new MissingMediaError()
          const file = Bun.file(join(MEDIA_DIR, item.path))
          // A post saved with an image must not go out without it. This used
          // to be skipped silently, which is how a deploy that wiped the
          // media folder turned image posts into text posts.
          if (!(await file.exists()))
            throw new MissingMediaError()
          media.push({
            bytes: new Uint8Array(await file.arrayBuffer()),
            // Also expose a public URL so URL-only providers (Instagram,
            // Threads) can publish the same uploaded file; byte-upload
            // providers (Bluesky, LinkedIn, Mastodon) keep using `bytes`.
            // Null when no public base is configured — then it's bytes-only.
            url: publicMediaUrl(item.path) ?? undefined,
            mimeType: item.mimeType,
            altText: item.altText,
          })
        }
        else if (item.url) {
          media.push({ url: item.url, altText: item.altText })
        }
      }
      if (media.length) content.media = media
    }

    return Object.keys(content).length ? content : undefined
  }

  private async removeStoredMedia(post: any): Promise<void> {
    const stored = parseStoredContent(await storedContentOf(post))
    for (const item of stored?.media || []) {
      if (!item.path || !isSafeMediaFilename(item.path)) continue
      await unlink(join(MEDIA_DIR, item.path)).catch(() => {})
    }
  }

  /**
   * Give back posts whose publish never finished.
   *
   * A post is claimed by setting it to `publishing`. If the process stops
   * before the results are written, nothing ever moves it on, and that state
   * can be neither retried, edited nor deleted. This finds posts that have
   * been `publishing` for longer than any publish takes and settles them.
   *
   * It never re-sends. A target with a result row went out, so its
   * placeholder is simply removed. A target with none may or may not have
   * reached the network, so it is marked failed with a reason that says to
   * check before retrying. Sending it again is the owner's decision.
   */
  async recoverStranded(olderThanMinutes = STRANDED_AFTER_MINUTES): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ')
    const stranded = await database
      .selectFrom('posts')
      .select(['id'])
      .where('status', '=', 'publishing')
      .where('updated_at', '<=', cutoff)
      .execute()

    let recovered = 0
    for (const post of stranded) {
      const rows = await database.selectFrom('post_targets').selectAll().where('post_id', '=', post.id).execute()
      const sent = new Set(rows
        .filter((row: any) => row.status === 'published')
        .map((row: any) => recordKey(row.provider, row.social_identity_id)))
      const at = now()

      for (const row of rows) {
        if (row.status !== 'publishing')
          continue
        if (sent.has(recordKey(row.provider, row.social_identity_id))) {
          await database.deleteFrom('post_targets').where('id', '=', row.id).execute()
          continue
        }
        await database.updateTable('post_targets').set({
          status: 'failed',
          failure_reason: STRANDED_REASON,
          updated_at: at,
        }).where('id', '=', row.id).execute()
      }

      // Only if it is still stranded: a run that was merely slow may have
      // finished between the read above and this write.
      const full = await database.selectFrom('posts').select(['published_at']).where('id', '=', post.id).executeTakeFirst()
      const settled = affected(await database.updateTable('posts').set({
        status: sent.size > 0 ? 'published' : 'failed',
        ...(sent.size > 0 && !full?.published_at ? { published_at: at } : {}),
        updated_at: at,
      }).where('id', '=', post.id).where('status', '=', 'publishing').execute())

      recovered += settled
      if (settled)
        log.warn(`[postline] post ${post.id} was stranded mid-publish and has been handed back (${sent.size} target(s) had gone out)`)
    }

    return recovered
  }

  /**
   * Publish every scheduled post whose time has come. Called by the
   * PublishScheduledPosts job every minute; failures on one post never block
   * the rest.
   */
  async publishDue(graceMinutes = LATE_GRACE_MINUTES): Promise<{ published: number, failed: number, missed: number }> {
    // Paused by the owner (#195): due posts stay queued until resumed.
    if ((await workspace.profile()).publishingPaused) return { published: 0, failed: 0, missed: 0 }
    await contentColumn()
    await this.recoverStranded()

    const due: Pick<ScheduledRow, 'id' | 'scheduled_at' | 'thread_key'>[] = await database
      .selectFrom('posts')
      .select(['id', 'scheduled_at', 'thread_key'])
      .where('status', '=', 'scheduled')
      .where('scheduled_at', '<=', now())
      .orderBy('id', 'asc')
      .execute()
    // A thread is sent once, through its first due segment, which sends all of it.
    const threadsSent = new Set<string>()

    const tooLate = new Date(Date.now() - graceMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ')

    let published = 0
    let failed = 0
    let missed = 0
    for (const post of due) {
      const scheduledAt = post.scheduled_at
      if (!scheduledAt) continue
      if (post.thread_key) {
        if (threadsSent.has(String(post.thread_key))) continue
        threadsSent.add(String(post.thread_key))
      }
      if (scheduledAt < tooLate) {
        // Too late for a thread is too late for every segment of it.
        const segments: Pick<ScheduledRow, 'id' | 'scheduled_at'>[] = post.thread_key
          ? await database.selectFrom('posts').select(['id', 'scheduled_at']).where('thread_key', '=', post.thread_key).where('status', '=', 'scheduled').execute()
          : [post]
        if (!segments.some(segment => segment.id === post.id && segment.scheduled_at === scheduledAt)) continue
        for (const segment of segments) {
          if (segment.scheduled_at)
            missed += await this.setAside(Number(segment.id), missedReason(scheduledAt), segment.scheduled_at)
        }
        continue
      }

      try {
        const { results } = await this.publishNow(Number(post.id), { expectedScheduledAt: scheduledAt })
        if (results.some(result => result.ok)) published += 1
        else failed += 1
      }
      catch (error) {
        // Another run has it: neither a publish nor a failure of this one.
        if (error instanceof AlreadyPublishingError)
          continue
        // Refused before anything was claimed or sent. Left as it was it
        // would be picked up and refused again every minute, so it is set
        // aside with the reason for the owner to fix.
        if (error instanceof MissingMediaError && !await this.setAside(Number(post.id), error.message, scheduledAt))
          continue
        // Swallowed so one post cannot stop the rest, but never silently.
        log.error(`[postline] scheduled post ${post.id} could not be published: ${error instanceof Error ? error.message : String(error)}`)
        failed += 1
      }
    }

    // Networks that failed for a reason sending again can fix, whose wait is
    // over. Each is sent on its own: the networks that have the post are not
    // touched.
    const retryable = await database
      .selectFrom('post_targets')
      .select(['post_id', 'next_attempt_at'])
      .where('status', '=', 'failed')
      .where('next_attempt_at', '<=', now())
      .execute()
    const retryPosts = [...new Set<number>(retryable.map((row: any) => Number(row.post_id)))]
    for (const postId of retryPosts) {
      try {
        const { results } = await this.publishNow(postId, { retriesOnly: true })
        if (results.some(result => result.ok)) published += 1
      }
      catch (error) {
        if (error instanceof AlreadyPublishingError)
          continue
        log.error(`[postline] retry of post ${postId} could not run: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return { published, failed, missed }
  }

  /**
   * Set aside a scheduled post that will not be sent by itself: one that is
   * too late, or one that cannot be sent as it stands. It becomes `failed`,
   * which the owner can publish now, edit, or delete; its targets carry the
   * reason. Nothing is sent.
   */
  private async setAside(postId: number, reason: string, scheduledAt: string): Promise<number> {
    const at = now()
    // A publish or reschedule may have moved the post since the due list was read.
    const held = affected(await database.updateTable('posts').set({
      status: 'failed',
      updated_at: at,
    }).where('id', '=', postId).where('status', '=', 'scheduled').where('scheduled_at', '=', scheduledAt).execute())
    if (held !== 1)
      return 0

    await database.updateTable('post_targets').set({
      status: 'failed',
      failure_reason: reason,
      updated_at: at,
    }).where('post_id', '=', postId).where('status', '=', 'scheduled').execute()

    await alerts.raise({
      kind: reason.startsWith(MISSED_PREFIX) ? 'post-missed' : 'post-failed',
      title: reason.startsWith(MISSED_PREFIX) ? 'A scheduled post was not sent' : 'A scheduled post could not be sent',
      body: reason,
      link: '/queue',
      key: `post-set-aside:${postId}`,
    })

    return 1
  }

  /**
   * A post that can be sent: one that is still actionable, or one that is
   * published but has networks that failed.
   */
  private async findPublishable(id: number, expectedScheduledAt?: string): Promise<any> {
    // Before any row is read: content an older version parked in `notes`
    // has to be in place first.
    await contentColumn()
    const post = await database
      .selectFrom('posts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    if (expectedScheduledAt && (post?.status !== 'scheduled' || post.scheduled_at !== expectedScheduledAt))
      throw new AlreadyPublishingError()
    if (!post)
      throw new Error('Post not found.')
    if (ACTIONABLE.has(String(post.status)))
      return post

    if (String(post.status) === 'published') {
      const failed = await database
        .selectFrom('post_targets')
        .select(['id'])
        .where('post_id', '=', post.id)
        .where('status', '=', 'failed')
        .execute()
      if (failed.length > 0)
        return post
    }

    if (String(post.status) === 'publishing')
      throw new AlreadyPublishingError()
    throw new Error('This post has nothing left to publish.')
  }

  private async findActionable(id: number): Promise<any> {
    // Before any row is read: content an older version parked in `notes`
    // has to be in place first.
    await contentColumn()
    const post = await database
      .selectFrom('posts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    if (!post)
      throw new Error('Post not found.')
    if (!ACTIONABLE.has(String(post.status)))
      throw new Error('Only draft, scheduled, or failed posts can be changed.')

    return post
  }
}

/** Targets from `post_targets` rows, de-duplicated per account. */
function targetsOf(rows: Array<{ provider: SocialProvider, social_identity_id?: number | null }>): PublishTarget[] {
  return dedupeTargets(rows.map(row => ({
    provider: row.provider,
    identityId: isAccountProvider(row.provider) ? Number(row.social_identity_id) || null : null,
  })))
}

function recordKey(provider: string, identityId: number | null | undefined): string {
  return `${provider}:${Number(identityId) || ''}`
}

function providerName(provider: SocialProvider): string {
  const names: Partial<Record<SocialProvider, string>> = {
    bluesky: 'Bluesky',
    twitter: 'X',
    mastodon: 'Mastodon',
    linkedin: 'LinkedIn',
    instagram: 'Instagram',
    threads: 'Threads',
  }
  return names[provider] || provider
}

export const postQueue = new QueueService()
