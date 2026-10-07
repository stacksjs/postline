import type { PublishTarget } from '../../Support/Social/targets'
import type { CrosspostTargetResult, PublishContent, SocialProvider } from '../../Support/Social/types'
import type { VariantMap } from '../../Support/Social/variants'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { dedupeTargets, isAccountProvider, parseTargets, targetKey, targetProviders } from '../../Support/Social/targets'
import { MEDIA_DIR, publicMediaUrl } from '../../Support/Social/uploads'
import { resolveStoredVariants, sanitizeVariants } from '../../Support/Social/variants'
import { crosspost, crosspostProviders } from './CrosspostService'
import { findIdentityRow, unavailableAccountError } from './identities'
import { ensureAccount, now, uuid } from './support'

const database = db as any

/**
 * The `posts` column that holds `StoredContent`.
 *
 * This used to be `posts.content`, added by a hand-written migration
 * (0000000031). The Post model never declared it, so when the schema was
 * regenerated from the models the column was not recreated: on any database
 * built from the current migrations, every queue save failed with "table posts
 * has no column named content" — drafts, schedules and campaign activation
 * alike.
 *
 * The model is not this service's to change, so the column is resolved at
 * runtime instead: `content` where it still exists (a database created before
 * the regeneration, whose queued posts already have their extras there), and
 * otherwise `notes` — the one free-form text column the model does declare,
 * and one nothing else in the app reads or writes. Declaring `content` on the
 * Post model is the proper fix; once it is, this picks it up with no change.
 */
let storedContentColumn: Promise<'content' | 'notes'> | null = null

async function contentColumn(): Promise<'content' | 'notes'> {
  storedContentColumn ??= database
    .selectFrom('posts')
    .select(['content'])
    .limit(1)
    .execute()
    .then(() => 'content' as const)
    .catch((error: unknown) => {
      // Only a missing column settles the answer. Anything else (a locked
      // database, say) must not pin the wrong column for the process lifetime.
      if (/no such column|has no column|unknown column|does not exist/i.test(String(error))) return 'notes' as const
      storedContentColumn = null
      throw error
    })
  return await storedContentColumn!
}

/** The stored-content value of a `posts` row read with `selectAll()`. */
async function storedContentOf(post: any): Promise<unknown> {
  return post?.[await contentColumn()]
}

/** Serialized into the stored-content column — everything beyond the text itself. */
interface StoredContent {
  /** Only set when the composer provided an explicit title. */
  title?: string
  external?: { uri: string, title: string, description?: string }
  media?: Array<{ url?: string, path?: string, mimeType?: string, altText?: string }>
  /**
   * Per-provider body overrides. Lives here rather than on `post_targets`
   * because those rows are a results ledger: `save` writes placeholders that
   * `publishAt` deletes immediately before publishing, so an override stored
   * there would be destroyed exactly when it is needed.
   */
  variants?: VariantMap
}

function parseStoredContent(raw: unknown): StoredContent | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(String(raw))
    return parsed && typeof parsed === 'object' ? parsed as StoredContent : null
  }
  catch {
    return null
  }
}

/** Post statuses a user may still act on (publish now, delete). */
const ACTIONABLE = new Set(['draft', 'scheduled', 'failed'])

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
  /** Attached image: raw bytes (stored to disk until publish) or a URL. */
  image?: { bytes?: Uint8Array, url?: string, mimeType?: string, altText?: string } | null
  /** Per-provider body overrides; providers without one publish `text`. */
  variants?: VariantMap | null
}

/**
 * Edit input. Both `image` and `variants` are tri-state:
 * undefined = keep what is stored, null = clear, object = replace.
 */
export interface UpdateQueueInput extends Omit<SaveQueueInput, 'image'> {
  image?: { bytes?: Uint8Array, url?: string, mimeType?: string, altText?: string } | null
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
  image: { kind: 'file' | 'url', url: string | null } | null
  /** Per-provider overrides, so an edit round-trips them instead of dropping them. */
  variants: VariantMap | null
}

export class QueueService {
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

    const scheduledAt = input.scheduledAt?.trim() || null
    if (scheduledAt) {
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(scheduledAt))
        throw new Error('Scheduled time must be a UTC YYYY-MM-DD HH:MM:SS timestamp.')
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
    if (input.image?.bytes?.length) {
      const extension = (input.image.mimeType || 'image/jpeg').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg'
      const filename = `${postUuid}.${extension}`
      await mkdir(MEDIA_DIR, { recursive: true })
      await Bun.write(join(MEDIA_DIR, filename), input.image.bytes)
      stored.media = [{ path: filename, mimeType: input.image.mimeType, altText: input.image.altText }]
    }
    else if (input.image?.url) {
      stored.media = [{ url: input.image.url, altText: input.image.altText }]
    }

    await database.insertInto('posts').values({
      uuid: postUuid,
      title: input.title?.trim() || body.slice(0, 80),
      body,
      status,
      [await contentColumn()]: Object.keys(stored).length ? JSON.stringify(stored) : null,
      scheduled_at: scheduledAt,
      timezone: env.TZ || 'America/Los_Angeles',
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

  /** Recent posts with their per-provider targets, newest first. */
  async list(limit = 50): Promise<QueueItemView[]> {
    const posts = await database
      .selectFrom('posts')
      .selectAll()
      .where('status', '!=', 'archived')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute()

    if (posts.length === 0)
      return []

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

    const column = await contentColumn()
    return posts.map((post: any): QueueItemView => {
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
            }
          }),
      }
    })
  }

  /** Delete a draft, scheduled, or failed post along with its targets. */
  async remove(id: number): Promise<void> {
    const post = await this.findActionable(id)
    await this.removeStoredMedia(post)
    await database.deleteFrom('post_targets').where('post_id', '=', post.id).execute()
    await database.deleteFrom('posts').where('id', '=', post.id).execute()
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
      variants: sanitizeVariants(stored?.variants) || null,
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

    const scheduledAt = input.scheduledAt?.trim() || null
    if (scheduledAt) {
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(scheduledAt))
        throw new Error('Scheduled time must be a UTC YYYY-MM-DD HH:MM:SS timestamp.')
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

    // Media: replace / remove / keep. Replacing or removing drops the old file.
    if (input.image === null || input.image?.bytes?.length || input.image?.url) {
      await this.removeStoredMedia(post)
    }
    if (input.image?.bytes?.length) {
      const extension = (input.image.mimeType || 'image/jpeg').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg'
      const filename = `${post.uuid}-${uuid().slice(0, 8)}.${extension}`
      await mkdir(MEDIA_DIR, { recursive: true })
      await Bun.write(join(MEDIA_DIR, filename), input.image.bytes)
      stored.media = [{ path: filename, mimeType: input.image.mimeType, altText: input.image.altText }]
    }
    else if (input.image?.url) {
      stored.media = [{ url: input.image.url, altText: input.image.altText }]
    }
    else if (input.image === undefined && existing?.media?.length) {
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

    return { postId: Number(post.id), status }
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

  /** Publish a draft/scheduled/failed post immediately. */
  async publishNow(id: number): Promise<{ postId: number, results: CrosspostTargetResult[] }> {
    const post = await this.findActionable(id)

    const placeholders = await database
      .selectFrom('post_targets')
      .selectAll()
      .where('post_id', '=', post.id)
      .where('status', 'in', ['draft', 'scheduled', 'failed'])
      .execute()

    // De-duplicated per account, not per network: two Bluesky accounts on one
    // post are two targets and both publish.
    const targets = targetsOf(placeholders)
    if (targets.length === 0)
      throw new Error('This post has no pending targets to publish.')

    await database.updateTable('posts').set({
      status: 'publishing',
      updated_at: now(),
    }).where('id', '=', post.id).execute()

    // The provider services insert fresh result rows; drop the placeholders
    // so the queue doesn't show both. (Deleted one-by-one — the query
    // builder mis-compiles `where in` on DELETE statements.)
    for (const target of placeholders) {
      await database.deleteFrom('post_targets').where('id', '=', target.id).execute()
    }

    const results = await crosspost.publishExisting(
      { id: Number(post.id), body: String(post.body) },
      targets,
      await this.hydrateContent(post),
    )

    const anyOk = results.some(result => result.ok)
    const finishedAt = now()

    // Providers that reject before reaching their own insert — an over-limit
    // body is checked first in every service — write no result row. Their
    // placeholder is already gone, so without this the target would vanish from
    // the queue entirely: no row, no failure reason, and the post still marked
    // published because some other network succeeded. Matched per account, so
    // one Bluesky account's row does not hide another's missing one.
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

    await database.updateTable('posts').set({
      status: anyOk ? 'published' : 'failed',
      ...(anyOk ? { published_at: finishedAt } : {}),
      updated_at: finishedAt,
    }).where('id', '=', post.id).execute()

    if (anyOk) await this.removeStoredMedia(post)

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

    if (stored.media?.length) {
      const media: NonNullable<PublishContent['media']> = []
      for (const item of stored.media) {
        if (item.path) {
          try {
            const file = Bun.file(join(MEDIA_DIR, item.path))
            if (await file.exists()) {
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
          }
          catch {}
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
      if (!item.path) continue
      await unlink(join(MEDIA_DIR, item.path)).catch(() => {})
    }
  }

  /**
   * Publish every scheduled post whose time has come. Called by the
   * PublishScheduledPosts job every minute; failures on one post never block
   * the rest.
   */
  async publishDue(): Promise<{ published: number, failed: number }> {
    const due = await database
      .selectFrom('posts')
      .select(['id'])
      .where('status', '=', 'scheduled')
      .where('scheduled_at', '<=', now())
      .execute()

    let published = 0
    let failed = 0
    for (const post of due) {
      try {
        const { results } = await this.publishNow(Number(post.id))
        if (results.some(result => result.ok)) published += 1
        else failed += 1
      }
      catch {
        failed += 1
      }
    }

    return { published, failed }
  }

  private async findActionable(id: number): Promise<any> {
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
