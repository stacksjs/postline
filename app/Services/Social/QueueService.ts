import type { CrosspostTargetResult, PublishContent, SocialProvider } from '../../Support/Social/types'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { db } from '@stacksjs/database'
import { env } from '@stacksjs/env'
import { crosspost, crosspostProviders } from './CrosspostService'
import { ensureAccount, now, uuid } from './support'

const database = db as any

/** Uploaded images for queued posts live here until publish. */
const MEDIA_DIR = join(process.cwd(), 'storage/app/postline-media')

/** Serialized into posts.content — everything beyond the text itself. */
interface StoredContent {
  /** Only set when the composer provided an explicit title. */
  title?: string
  external?: { uri: string, title: string, description?: string }
  media?: Array<{ url?: string, path?: string, mimeType?: string, altText?: string }>
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
  providers: SocialProvider[]
  /** Explicit title for long-form targets (blog). */
  title?: string | null
  /** UTC `YYYY-MM-DD HH:MM:SS`; omitted → saved as a draft. */
  scheduledAt?: string | null
  external?: { uri: string, title: string, description?: string } | null
  /** Attached image: raw bytes (stored to disk until publish) or a URL. */
  image?: { bytes?: Uint8Array, url?: string, mimeType?: string, altText?: string } | null
}

export class QueueService {
  /**
   * Persist a post without publishing it. With `scheduledAt` the post is
   * queued (`scheduled`) and picked up by the PublishScheduledPosts job when
   * due; without it the post is stored as a `draft`. One placeholder
   * `post_targets` row per provider records where the post should go — the
   * real result rows replace them at publish time.
   */
  async save(input: SaveQueueInput): Promise<{ postId: number, status: 'draft' | 'scheduled', scheduledAt: string | null }> {
    const body = input.text.trim()
    if (!body)
      throw new Error('Post text is required.')

    const available = new Set<string>(crosspostProviders())
    const providers = input.providers.filter(provider => available.has(provider))
    if (providers.length === 0)
      throw new Error('Select at least one connected provider.')

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
      content: Object.keys(stored).length ? JSON.stringify(stored) : null,
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

    for (const provider of providers) {
      await database.insertInto('post_targets').values({
        uuid: uuid(),
        provider,
        status,
        scheduled_at: scheduledAt,
        post_id: post.id,
        created_at: createdAt,
        updated_at: createdAt,
      }).execute()
    }

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

    return posts.map((post: any): QueueItemView => ({
      id: Number(post.id),
      title: post.title || null,
      body: String(post.body || ''),
      status: String(post.status),
      scheduledAt: post.scheduled_at || null,
      publishedAt: post.published_at || null,
      createdAt: String(post.created_at),
      hasImage: Boolean(parseStoredContent(post.content)?.media?.length),
      hasLink: Boolean(parseStoredContent(post.content)?.external),
      providers: targets
        .filter((target: any) => Number(target.post_id) === Number(post.id))
        .map((target: any): QueueTargetView => ({
          provider: target.provider,
          status: String(target.status),
          remoteUri: target.remote_uri || null,
          failureReason: target.failure_reason || null,
        })),
    }))
  }

  /** Delete a draft, scheduled, or failed post along with its targets. */
  async remove(id: number): Promise<void> {
    const post = await this.findActionable(id)
    await this.removeStoredMedia(post)
    await database.deleteFrom('post_targets').where('post_id', '=', post.id).execute()
    await database.deleteFrom('posts').where('id', '=', post.id).execute()
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

    const providers = [...new Set(placeholders.map((target: any) => target.provider))] as SocialProvider[]
    if (providers.length === 0)
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
      providers,
      await this.hydrateContent(post),
    )

    const anyOk = results.some(result => result.ok)
    const finishedAt = now()
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
    const stored = parseStoredContent(post.content)
    if (!stored) return undefined

    const content: PublishContent = {}
    if (stored.title) content.title = stored.title
    if (stored.external) content.external = stored.external

    if (stored.media?.length) {
      const media: NonNullable<PublishContent['media']> = []
      for (const item of stored.media) {
        if (item.path) {
          try {
            const file = Bun.file(join(MEDIA_DIR, item.path))
            if (await file.exists()) {
              media.push({
                bytes: new Uint8Array(await file.arrayBuffer()),
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
    const stored = parseStoredContent(post.content)
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

export const postQueue = new QueueService()
